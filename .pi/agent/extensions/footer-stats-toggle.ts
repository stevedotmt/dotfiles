/**
 * Footer Stats Toggle - /stats to hide/show the footer stats line
 *
 * Shown: pi's built-in footer.
 * Hidden: a compact footer with pwd (git branch) • session name on the left,
 * model • thinking level on the right, and extension statuses below.
 *
 * Preference persists across restarts in ~/.pi/agent/footer-stats.json.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PREFS_FILE = path.join(os.homedir(), ".pi", "agent", "footer-stats.json");

function loadHidden(): boolean {
	try {
		return JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")).hidden === true;
	} catch {
		return false;
	}
}

function saveHidden(hidden: boolean): void {
	try {
		fs.writeFileSync(PREFS_FILE, JSON.stringify({ hidden }), "utf8");
	} catch {
		// Non-fatal: preference just won't persist
	}
}

function compactFooter(ctx: ExtensionContext) {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsub = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsub,
			invalidate() {},
			render(width: number): string[] {
				const home = os.homedir();
				const cwd = ctx.sessionManager.getCwd();
				let left = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
				const branch = footerData.getGitBranch();
				if (branch) left += ` (${branch})`;
				const sessionName = ctx.sessionManager.getSessionName();
				if (sessionName) left += ` • ${sessionName}`;

				const model = ctx.model;
				let right = model?.id ?? "no-model";
				if (model?.reasoning) {
					const level = ctx.thinkingLevel || "off";
					right += level === "off" ? " • thinking off" : ` • ${level}`;
				}
				if (model && footerData.getAvailableProviderCount() > 1) right = `(${model.provider}) ${right}`;

				const lines: string[] = [];
				const rightWidth = visibleWidth(right);
				if (rightWidth + 2 < width) {
					const leftTruncated = truncateToWidth(left, width - rightWidth - 2, "...");
					const pad = " ".repeat(width - visibleWidth(leftTruncated) - rightWidth);
					lines.push(theme.fg("dim", leftTruncated + pad + right));
				} else {
					lines.push(theme.fg("dim", truncateToWidth(left, width, "...")));
				}

				const statuses = [...footerData.getExtensionStatuses().entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => text.replace(/\s+/g, " ").trim());
				if (statuses.length > 0) {
					lines.push(truncateToWidth(statuses.join(" "), width, theme.fg("dim", "...")));
				}
				return lines;
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	let hidden = loadHidden();

	const apply = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (hidden) compactFooter(ctx);
		else ctx.ui.setFooter(undefined);
	};

	pi.registerCommand("stats", {
		description: "Toggle the footer stats line (tokens, cost, context usage)",
		handler: async (_args, ctx) => {
			hidden = !hidden;
			saveHidden(hidden);
			apply(ctx);
			ctx.ui.notify(hidden ? "Footer stats hidden (/stats to show)" : "Footer stats shown", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => apply(ctx));
}
