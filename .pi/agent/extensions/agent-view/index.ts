import { existsSync } from "node:fs";
import { CustomEditor, getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";
import { canonical, clean, readRows, readSavedRows, saveRow, sessionTitle, storeDir, type AgentRow } from "./store.ts";
import { AgentView, NEW_SESSION, type Selection } from "./view.ts";

export default function (pi: ExtensionAPI) {
	let row: AgentRow | undefined;
	let dir = "";
	let opened = false;
	let waiting: string | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let pending: ReturnType<typeof setTimeout> | undefined;
	let stopView: (() => void) | undefined;
	let storageError = "";
	let lastStop = "";

	function snapshot(): AgentRow {
		return { ...row!, ...(waiting ? { state: "waiting", summary: waiting } : {}) };
	}

	function publish(): void {
		if (!row) return;
		row.updated = Date.now();
		if (!row.file) return; // --no-session stays in memory.
		try { saveRow(dir, snapshot()); storageError = ""; }
		catch { storageError = "Could not update session presence"; }
	}

	function update(patch: Partial<AgentRow>): void {
		if (!row) return;
		Object.assign(row, patch);
		if (pending) return;
		pending = setTimeout(() => { pending = undefined; publish(); }, 150);
		pending.unref();
	}

	function selectionError(context: ExtensionContext, selected: Selection): string | undefined {
		if (!selected || (selected !== NEW_SESSION && selected.id === context.sessionManager.getSessionId())) return;
		if (!context.isIdle() || context.hasPendingMessages()) return "Let this response finish before switching sessions.";
		if (context.ui.getEditorText()) return "Clear or send your draft before switching sessions.";
		if (selected === NEW_SESSION) return;
		const latest = readRows(dir, context.cwd).find((item) => item.id === selected.id) ?? selected;
		if (latest.live) return "This session is open in another terminal. Close it there before resuming here.";
		if (!selected.file || !existsSync(selected.file)) return "This session is no longer available.";
	}

	async function open(context: ExtensionCommandContext): Promise<void> {
		if (context.mode !== "tui" || opened || waiting || !row) return;
		opened = true;
		try {
			const selected = await context.ui.custom<Selection>((tui, theme, _kb, done) => {
				const view = new AgentView(theme, {
					cwd: context.cwd, currentId: row!.id,
					height: () => tui.terminal.rows,
					redraw: () => tui.requestRender(),
					choose: (selection) => {
						const error = selectionError(context, selection);
						if (error) return error;
						done(selection);
					},
				});
				let saved: AgentRow[] = [];
				let savedError = "";
				let disposed = false;
				const refresh = () => {
					if (disposed || !row) return;
					try {
						const merged = new Map(saved.map((item) => [item.id, item]));
						for (const item of readRows(dir, context.cwd)) {
							// Older presence records shortened titles. Use saved metadata for closed sessions.
							const name = item.live ? item.name : merged.get(item.id)?.name ?? item.name;
							merged.set(item.id, { ...item, name });
						}
						merged.set(row.id, snapshot());
						view.update([...merged.values()], storageError || savedError);
					} catch { view.update([...saved, snapshot()], "Could not read session presence"); }
				};
				const timer = setInterval(refresh, 2000);
				timer.unref();
				stopView = () => done(undefined);
				refresh();
				void readSavedRows(context.cwd).then((rows) => {
					if (disposed) return;
					saved = rows;
					refresh();
				}).catch(() => {
					if (disposed) return;
					savedError = "Could not load saved sessions";
					refresh();
				});
				return Object.assign(view, {
					dispose() { disposed = true; clearInterval(timer); stopView = undefined; },
				});
			}, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left" } });
			if (!selected || (selected !== NEW_SESSION && selected.id === context.sessionManager.getSessionId())) return;
			// Recheck after closing the overlay. Never use the old context after replacement.
			const error = selectionError(context, selected);
			if (error) { context.ui.notify(error, "warning"); return; }
			if (selected === NEW_SESSION) await context.newSession();
			else await context.switchSession(selected.file!);
		} catch (error) {
			context.ui.notify(`Agent view: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally { opened = false; }
	}

	pi.registerCommand("agents", {
		description: "View Pi sessions in this directory",
		handler: async (args, context) => {
			if (args.trim()) { context.ui.notify("Usage: /agents", "info"); return; }
			await open(context);
		},
	});
	// After session_start, wrap whichever editor is installed without changing its styling.
	pi.on("resources_discover", (_event, context) => {
		if (context.mode !== "tui") return;
		const previous = context.ui.getEditorComponent();
		context.ui.setEditorComponent((tui, theme, kb) => {
			const editor = previous?.(tui, theme, kb) ?? new CustomEditor(tui, theme, kb);
			const handleInput = editor.handleInput.bind(editor);
			editor.handleInput = (data: string) => {
				if (!isKeyRelease(data) && matchesKey(data, "left") && editor.getText() === "") {
					// Commands execute immediately and supply the session-switching context.
					pi.sendUserMessage("/agents", { expandPromptTemplates: true, deliverAs: "steer" });
				} else handleInput(data);
			};
			return editor;
		});
	});

	pi.on("session_start", (_event, context) => {
		const sm = context.sessionManager;
		const first = sm.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user");
		const firstText = first?.type === "message" && "content" in first.message ? textContent(first.message.content) : "";
		row = {
			id: sm.getSessionId(), cwd: canonical(context.cwd), file: sm.getSessionFile(),
			name: sessionTitle(sm.getSessionName(), firstText || "New session"),
			summary: context.isIdle() ? "Ready for a prompt" : "Working…",
			state: context.isIdle() ? "idle" : "working",
			started: Date.parse(sm.getHeader()?.timestamp ?? "") || Date.now(),
			updated: Date.now(), live: true, pid: process.pid,
		};
		dir = storeDir(getAgentDir(), context.cwd);
		publish();
		heartbeat = setInterval(publish, 5000);
		heartbeat.unref();
		if (context.mode === "tui") context.ui.setStatus("agent-view", undefined);
	});
	pi.on("session_info_changed", (event) => update({ name: sessionTitle(event.name, "Untitled session") }));
	pi.on("before_agent_start", (event, context) => update({
		name: sessionTitle(context.sessionManager.getSessionName(), event.prompt), summary: clean(event.prompt),
	}));
	pi.on("agent_start", () => { lastStop = ""; update({ state: "working", ended: undefined }); });
	pi.on("tool_execution_start", (event) => {
		const args = event.args as Record<string, unknown>;
		const detail = args.path ?? args.command ?? args.query ?? "";
		update({ summary: clean(`${event.toolName}${typeof detail === "string" && detail ? ` · ${detail}` : ""}`) });
	});
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		lastStop = event.message.stopReason;
		const text = event.message.errorMessage || textContent(event.message.content);
		if (text) update({ summary: clean(text) });
	});
	pi.on("agent_settled", () => update({
		state: lastStop === "error" ? "failed" : lastStop === "aborted" ? "stopped"
			: lastStop === "stop" || lastStop === "length" ? "completed" : "idle",
		ended: Date.now(),
	}));
	pi.on("ui_prompt_start", (event) => {
		if (!opened) { waiting = clean(event.title || "Waiting for your input"); update({}); }
	});
	pi.on("ui_prompt_end", () => { if (waiting) { waiting = undefined; update({}); } });
	pi.on("session_shutdown", () => {
		if (heartbeat) clearInterval(heartbeat);
		if (pending) clearTimeout(pending);
		stopView?.();
		waiting = undefined;
		if (row) {
			row.live = false;
			if (row.state === "working") { row.state = "stopped"; row.ended = Date.now(); }
			publish();
		}
		row = undefined;
	});
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join(" ");
}
