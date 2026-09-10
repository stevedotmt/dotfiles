/**
 * Model Shortcuts
 *
 * Registers one slash command per entry in a JSON config file, for quick
 * model switching: /kimi, /fable, /astra, ...
 *
 * Config files (merged, project-local takes precedence):
 * - ~/.pi/agent/model-shortcuts.json (global)
 * - <cwd>/.pi/model-shortcuts.json (project-local)
 *
 * Format:
 * {
 *   "kimi":  { "provider": "fireworks", "model": "accounts/fireworks/models/kimi-k3" },
 *   "fable": { "provider": "anthropic", "model": "claude-fable-5", "thinkingLevel": "high" }
 * }
 *
 * - "thinkingLevel" is optional. If omitted, the current thinking level is
 *   kept (pi clamps it to the model's capabilities).
 * - Any command also accepts an ad-hoc thinking level override, e.g.
 *   "/astra max" switches to the configured model with thinking set to max.
 *
 * To add/remove shortcuts: edit the JSON, then run /reload.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

interface Shortcut {
	/** Provider id (e.g. "anthropic", "fireworks", "openai") */
	provider: string;
	/** Model id within the provider */
	model: string;
	/** Optional thinking level applied after switching */
	thinkingLevel?: ThinkingLevel;
}

type ShortcutsConfig = Record<string, Shortcut>;

function loadConfigFile(path: string): ShortcutsConfig {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as ShortcutsConfig;
	} catch (err) {
		console.error(`Failed to load model shortcuts from ${path}: ${err}`);
		return {};
	}
}

function loadShortcuts(cwd: string): ShortcutsConfig {
	const globalPath = join(getAgentDir(), "model-shortcuts.json");
	const projectPath = join(cwd, CONFIG_DIR_NAME, "model-shortcuts.json");
	// Project-local entries override global ones with the same name
	return { ...loadConfigFile(globalPath), ...loadConfigFile(projectPath) };
}

export default function (pi: ExtensionAPI) {
	const shortcuts = loadShortcuts(process.cwd());

	for (const [name, shortcut] of Object.entries(shortcuts)) {
		const target = `${shortcut.provider}/${shortcut.model}`;
		const thinking = shortcut.thinkingLevel ? ` (thinking: ${shortcut.thinkingLevel})` : "";

		pi.registerCommand(name, {
			description: `Switch to ${target}${thinking}`,
			getArgumentCompletions: (prefix: string) => {
				const items = THINKING_LEVELS.filter((l) => l.startsWith(prefix)).map((l) => ({ value: l, label: l }));
				return items.length > 0 ? items : null;
			},
			handler: async (args, ctx) => {
				const model = ctx.modelRegistry.find(shortcut.provider, shortcut.model);
				if (!model) {
					ctx.ui.notify(`Model ${target} not found or unavailable (check provider auth)`, "error");
					return;
				}

				const success = await pi.setModel(model);
				if (!success) {
					ctx.ui.notify(`No API key available for ${target}`, "error");
					return;
				}

				// Ad-hoc thinking level override: /fable max
				let level = shortcut.thinkingLevel;
				const arg = args?.trim();
				if (arg) {
					if ((THINKING_LEVELS as readonly string[]).includes(arg)) {
						level = arg as ThinkingLevel;
					} else {
						ctx.ui.notify(`Unknown thinking level "${arg}". Valid: ${THINKING_LEVELS.join(", ")}`, "warning");
					}
				}
				if (level) {
					pi.setThinkingLevel(level);
				}

				const applied = level ? `, thinking: ${pi.getThinkingLevel()}` : "";
				ctx.ui.notify(`Switched to ${target}${applied}`, "info");
			},
		});
	}
}
