/**
 * Minimal Tools - hide built-in tool output until expanded
 *
 * Compatibility checks: node ~/.pi/agent/extensions/minimal-tools/test.mjs
 *
 * Collapsed (default): the tool call clipped to one line; results hidden unless
 * the call failed. Expanded (ctrl+o or click): pi's normal rendering.
 * Codemode also keeps failed or cancelled nested calls visible when collapsed.
 *
 * File tools use pi's create*ToolDefinition(); codemode uses its public extension
 * factory. Execution, model-facing fields, and expanded rendering come from pi.
 * pi's renderers always run (edit-style renderers settle state there); when
 * collapsed their output is clipped or swapped for an empty placeholder.
 *
 * - edit and write stay pure built-ins: pi already shows nothing for their
 *   successful results.
 * - Tool options mirror what pi passes when building its own tools
 *   (AgentSession._buildRuntime), via pi's SettingsManager getters.
 * - defaultActive: false leaves the active tool set to pi and settings.
 * - Settings are unavailable while extensions load, so tools register from
 *   defaults and re-register on session_start if the settings-built definition
 *   differs in any non-function field (everything the model sees).
 * - A tool that can't be built or lacks a renderer keeps pi's built-in, and a
 *   renderer that throws falls back to pi's default output, so pi API changes
 *   degrade to default rendering rather than broken tools.
 */

import {
	createBashToolDefinition,
	createCodemodeExtension,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	type CodemodeToolDetails,
	type ExtensionAPI,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type AnyToolDefinition = ToolDefinition<any, any, any>;
type RenderCall = NonNullable<AnyToolDefinition["renderCall"]>;
type RenderResult = NonNullable<AnyToolDefinition["renderResult"]>;
type Theme = Parameters<RenderCall>[1];
type Factory = (cwd: string, settings: SettingsManager) => AnyToolDefinition;

const FACTORIES: Record<string, Factory> = {
	read: (cwd, s) => createReadToolDefinition(cwd, { autoResizeImages: s.getImageAutoResize() }),
	bash: (cwd, s) =>
		createBashToolDefinition(cwd, { commandPrefix: s.getShellCommandPrefix(), shellPath: s.getShellPath() }),
	grep: (cwd) => createGrepToolDefinition(cwd),
	find: (cwd) => createFindToolDefinition(cwd),
	ls: (cwd) => createLsToolDefinition(cwd),
};

/** Per-row state, kept in pi's renderer state so each original renderer gets back its own lastComponent. */
type RowState = { call?: Component; result?: Component; errors?: Component; firstLine?: FirstLine; placeholder?: Container };
const ROW = Symbol("minimalTools");

/** Wide enough that a command's own lines don't word-wrap before being clipped. */
const UNWRAP_FACTOR = 4;
const ANSI = /\x1b\[[0-9;]*m/g;

export default function (pi: ExtensionAPI) {
	const settings = () => SettingsManager.inMemory(pi.getSettings());
	const registered = new Map<string, string>(); // tool name -> dataFields() of the definition it wraps

	const register = (name: string, base: AnyToolDefinition | undefined) => {
		const factory = FACTORIES[name];
		const tool = base && minimalTool({
			...base,
			execute(...args: Parameters<AnyToolDefinition["execute"]>) {
				return factory(args[4]?.cwd ?? process.cwd(), settings()).execute(...args);
			},
		});
		if (!tool) return;
		registered.set(name, dataFields(base));
		pi.registerTool(tool);
	};

	for (const [name, factory] of Object.entries(FACTORIES)) {
		register(name, tryCreate(factory, process.cwd(), SettingsManager.inMemory()));
	}

	// Preserve codemode's execution closures, loadout hook, and store persistence.
	createCodemodeExtension()({
		...pi,
		registerTool(base) {
			pi.registerTool(minimalTool(base) ?? base);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		const current = settings();
		for (const [name, fields] of registered) {
			const expected = tryCreate(FACTORIES[name], ctx.cwd, current);
			if (expected && dataFields(expected) !== fields) register(name, expected);
		}
		const skipped = Object.keys(FACTORIES).filter((name) => !registered.has(name));
		if (skipped.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`minimal-tools: using pi's default rendering for ${skipped.join(", ")}`, "warning");
		}
	});
}

function minimalTool(base: AnyToolDefinition) {
	const { renderCall, renderResult } = base;
	if (!renderCall || !renderResult) return undefined;

	return {
		...base,
		defaultActive: false,

		renderCall(...args: Parameters<RenderCall>) {
			const [params, theme, context, ...rest] = args;
			const row = rowState(context.state);
			row.call = renderCall(params, theme, { ...context, lastComponent: row.call }, ...(rest as []));
			if (context.expanded) return row.call;
			row.firstLine ??= new FirstLine();
			return row.firstLine.wrap(row.call, theme);
		},

		renderResult(...args: Parameters<RenderResult>) {
			const [result, options, theme, context, ...rest] = args;
			const row = rowState(context.state);
			row.result = renderResult(result, options, theme, { ...context, lastComponent: row.result }, ...(rest as []));
			if (options.expanded || context.isError) return row.result;
			if (base.name === "codemode") {
				const details = result.details as CodemodeToolDetails | undefined;
				const failures = details?.calls.filter((call) => call.status === "error" || call.status === "cancelled") ?? [];
				if (failures.length > 0) {
					// A script can catch nested failures and still return a successful result.
					row.errors = renderResult(
						{ ...result, content: [], details: { ...details, calls: failures } },
						{ ...options, expanded: true },
						theme,
						{ ...context, expanded: true, lastComponent: row.errors },
					);
					return row.errors;
				}
			}
			row.placeholder ??= new Container();
			return row.placeholder;
		},
	} satisfies AnyToolDefinition;
}

function rowState(state: unknown): RowState {
	const holder = state as { [ROW]?: RowState };
	holder[ROW] ??= {};
	return holder[ROW];
}

/** Shows only the first line of a component, with a count of the hidden lines. */
class FirstLine implements Component {
	private inner!: Component;
	private theme!: Theme;

	wrap(inner: Component, theme: Theme): this {
		this.inner = inner;
		this.theme = theme;
		return this;
	}

	render(width: number): string[] {
		const lines = this.inner.render(width * UNWRAP_FACTOR); // may be the inner's cache: don't mutate
		let count = lines.length;
		while (count > 1 && isBlank(lines[count - 1])) count--;
		if (count === 0) return [];
		const hidden = count - 1;
		const hint = hidden > 0 ? this.theme.fg("muted", ` … +${hidden} line${hidden === 1 ? "" : "s"}`) : "";
		const first = trimEndKeepAnsi(lines[0]);
		const room = Math.max(0, width - visibleWidth(hint));
		return [(visibleWidth(first) <= room ? first : keepBackground(truncateToWidth(first, room, "…"))) + hint];
	}

	invalidate(): void {
		this.inner.invalidate();
	}
}

/**
 * truncateToWidth closes styles with a full reset (\x1b[0m), which also clears the
 * row background the enclosing Box set at line start. Reset only foreground and
 * text attributes instead.
 */
function keepBackground(line: string): string {
	return line.replaceAll("\x1b[0m", "\x1b[22;23;24;27;29;39m");
}

/** Drops trailing padding spaces but keeps trailing ANSI codes (resets), so the hint sits right after the text. */
function trimEndKeepAnsi(line: string): string {
	return line.replace(/(?: |\x1b\[[0-9;]*m)+$/, (tail) => tail.replaceAll(" ", ""));
}

function isBlank(line: string): boolean {
	return line.replace(ANSI, "").trim() === "";
}

function tryCreate(factory: Factory | undefined, cwd: string, settings: SettingsManager) {
	try {
		return factory?.(cwd, settings);
	} catch {
		return undefined;
	}
}

/** Every non-function field (JSON drops functions): description, schema, prompt snippets, and anything pi adds later. */
function dataFields(tool: AnyToolDefinition): string {
	return JSON.stringify(tool);
}
