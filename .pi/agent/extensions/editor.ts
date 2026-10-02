/**
 * Cursor-like editor: no ─ borders, pale bar, dark text.
 *
 * Horizontal padding comes from the `editorPaddingX` setting.
 * Tweak vertical spacing / colors below, then /reload.
 */

import {
	CustomEditor,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const PADDING_Y = 1; // filled rows inside the bar (above/below text)
const MARGIN_Y = 1; // unfilled rows outside the bar (above/below)

const SGR_RESET = "\x1b[0m";
const RESET_INVERSE = "\x1b[27m";
const BAR_BG = "\x1b[48;2;245;245;245m"; // pale fill so the bar still reads on white
const BAR_FG = "\x1b[38;2;8;8;8m"; // text / black1 #080808

function isBorderLine(line: string): boolean {
	return line.replace(/\x1b\[[0-9;]*m/g, "").startsWith("─");
}

function fill(line: string, width: number): string {
	const pad = " ".repeat(Math.max(0, width - visibleWidth(line)));
	return `${BAR_BG}${BAR_FG}${line.replaceAll(SGR_RESET, RESET_INVERSE)}${pad}\x1b[49m\x1b[39m`;
}

function times(n: number, line: string): string[] {
	return Array.from({ length: n }, () => line);
}

class CursorLikeEditor extends CustomEditor {
	render(width: number): string[] {
		const lines = super.render(width);
		const bottom = lines.findLastIndex(isBorderLine);
		if (bottom < 1) return lines;

		const blank = fill("", width);
		const gap = " ".repeat(width);
		return [
			...times(MARGIN_Y, gap),
			...times(PADDING_Y, blank),
			...lines.slice(1, bottom).map((line) => fill(line, width)),
			...times(PADDING_Y, blank),
			...lines.slice(bottom + 1),
			...times(MARGIN_Y, gap),
		];
	}
}

export default function(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent(
			(tui, theme, kb) => new CursorLikeEditor(tui, theme, kb),
		);
	});
}
