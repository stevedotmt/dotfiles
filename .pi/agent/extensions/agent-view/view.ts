import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clean, type AgentRow } from "./store.ts";

export const NEW_SESSION = "new";
export type Selection = AgentRow | typeof NEW_SESSION | undefined;
interface ViewOptions {
	cwd: string;
	currentId: string;
	height: () => number;
	redraw: () => void;
	// Return a reason to keep the view open, or accept the choice. Undefined closes it.
	choose: (selection: Selection) => string | void;
}

const groups = [
	{ name: "Needs input", states: ["waiting"], color: "warning" },
	{ name: "Working", states: ["working"], color: "accent" },
	{ name: "Idle", states: ["idle"], color: "muted" },
	{ name: "Completed", states: ["completed", "failed", "stopped"], color: "success" },
] as const;

function groupIndex(row: AgentRow): number {
	return groups.findIndex((group) => (group.states as readonly string[]).includes(row.state));
}

export function sortRows(rows: AgentRow[]): AgentRow[] {
	return [...rows].sort((a, b) => groupIndex(a) - groupIndex(b) || Number(b.live) - Number(a.live)
		|| b.updated - a.updated || a.id.localeCompare(b.id));
}

export function age(row: AgentRow, now: number): string {
	const seconds = Math.max(0, Math.floor(((row.ended ?? now) - row.started) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}

export class AgentView {
	rows: AgentRow[] = [];
	selected = "";
	private error = "";
	private actionError = "";
	private peek = false;
	private offset = 0;
	private idleTotal = 0;

	constructor(private theme: Theme, private options: ViewOptions) {}

	update(rows: AgentRow[], error = ""): void {
		const sorted = sortRows(rows);
		this.error = error;
		const idle = sorted.filter((row) => row.state === "idle");
		this.idleTotal = idle.length;
		const current = idle.find((row) => row.id === this.options.currentId);
		const visibleIdle = new Set((current ? [current, ...idle.filter((row) => row !== current)] : idle)
			.slice(0, 5).map((row) => row.id));
		this.rows = sorted.filter((row) => row.state !== "idle" || visibleIdle.has(row.id));
		if (this.selected !== NEW_SESSION && !this.rows.some((row) => row.id === this.selected)) {
			this.selected = this.rows.find((row) => row.id === this.options.currentId)?.id ?? this.rows[0]?.id ?? NEW_SESSION;
		}
		this.options.redraw();
	}

	private choose(selection: Selection): void {
		try { this.actionError = this.options.choose(selection) || ""; }
		catch { this.actionError = "Could not check session status. Try again."; }
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "left") || matchesKey(data, "ctrl+c")) {
			if (this.peek) this.peek = false;
			else { this.choose(undefined); return; }
		} else if (matchesKey(data, "n") || matchesKey(data, "enter") || matchesKey(data, "right")) {
			if (matchesKey(data, "n")) this.selected = NEW_SESSION;
			this.choose(this.selected === NEW_SESSION ? NEW_SESSION : this.rows.find((row) => row.id === this.selected));
		} else if (matchesKey(data, "space")) {
			this.peek = !this.peek;
		} else {
			this.actionError = "";
			const keys = [...this.rows.map((row) => row.id), NEW_SESSION];
			let next = Math.max(0, keys.indexOf(this.selected));
			if (matchesKey(data, "up") || data === "k") next--;
			if (matchesKey(data, "down") || data === "j") next++;
			if (matchesKey(data, "pageUp")) next -= 8;
			if (matchesKey(data, "pageDown")) next += 8;
			if (matchesKey(data, "home")) next = 0;
			if (matchesKey(data, "end")) next = keys.length - 1;
			this.selected = keys[Math.max(0, Math.min(next, keys.length - 1))];
		}
		this.options.redraw();
	}

	render(width: number): string[] {
		const th = this.theme;
		const { cwd, currentId } = this.options;
		const height = Math.max(1, this.options.height());
		if (width < 32 || height < 10) return [truncateToWidth("Agents · enlarge terminal · esc back", width)];
		const inner = width - 2; // Left inset only; elapsed time ends at the terminal's right edge.
		const fit = (text: string, size = inner) => {
			const clipped = truncateToWidth(text, size, "…");
			return clipped + " ".repeat(Math.max(0, size - visibleWidth(clipped)));
		};
		const ends = (left: string, right: string) => fit(left, Math.max(0, inner - visibleWidth(right) - 1)) + " " + right;
		const rule = th.fg("borderMuted", "─".repeat(inner));
		const lines = [
			"",
			th.bold("Agents"),
			th.fg("muted", clean(cwd)),
			rule,
		];
		const selected = this.rows.find((row) => row.id === this.selected);
		const detail: string[] = [];
		if (this.peek && selected && height >= 17) {
			const state = selected.state === "waiting" ? "Needs input" : selected.state[0].toUpperCase() + selected.state.slice(1);
			detail.push(rule, th.bold("Latest activity") + th.fg("dim", ` · ${state}`));
			detail.push(...wrapTextWithAnsi(clean(selected.summary), inner).slice(0, 3).map((line) => th.fg("muted", line)));
			detail.push(th.fg("dim", selected.id === currentId ? "This conversation"
				: selected.live ? "Live in another terminal · read-only preview" : "Enter to resume"));
		}
		const available = Math.max(2, height - lines.length - detail.length - 4);
		const list: { text: string; id?: string; group: number }[] = [];
		const now = Date.now();
		const timeWidth = Math.max(4, ...this.rows.map((row) => age(row, now).length));
		const titleWidth = Math.max(1, inner - 4 - 2 - timeWidth);
		for (const [index, group] of groups.entries()) {
			const rows = this.rows.filter((row) => groupIndex(row) === index);
			if (!rows.length) continue;
			if (list.length) list.push({ text: "", group: index });
			const count = group.name === "Idle" && this.idleTotal > rows.length
				? `${rows.length} of ${this.idleTotal} · /resume for all` : String(rows.length);
			list.push({ text: th.fg(group.color, th.bold(group.name)) + th.fg("dim", `  ${count}`), group: index });
			for (const row of rows) {
				const color = row.state === "failed" ? "error" : row.state === "stopped" ? "dim" : group.color;
				const icon = row.state === "failed" ? "×" : row.state === "completed" ? "✓" : row.live ? "●" : "·";
				const active = row.id === this.selected;
				const name = clean(row.name, row.name.length) + (row.id === currentId ? " · you" : "");
				const title = row.id === currentId || active ? th.bold(name) : name;
				const prefix = (active ? th.fg("accent", "› ") : "  ") + th.fg(color, icon) + " ";
				const duration = th.fg("dim", age(row, now).padStart(timeWidth));
				for (const [lineIndex, line] of wrapTextWithAnsi(title, titleWidth).entries()) {
					const text = (lineIndex === 0 ? prefix : "    ") + fit(line, titleWidth) + "  "
						+ (lineIndex === 0 ? duration : " ".repeat(timeWidth));
					list.push({ text: active ? th.bg("userMessageBg", text) : text, id: row.id, group: index });
				}
			}
		}
		const cursor = list.findIndex((line) => line.id === this.selected);
		if (cursor >= 0) {
			const lastLine = list.findLastIndex((line) => line.id === this.selected);
			const selectedHeight = Math.min(lastLine - cursor + 1, available - 1);
			if (cursor < this.offset + 1) this.offset = Math.max(0, cursor - 1);
			if (cursor + selectedHeight > this.offset + available) this.offset = cursor + selectedHeight - available;
		}
		this.offset = Math.max(0, Math.min(this.offset, list.length - available));
		const window = list.slice(this.offset, this.offset + available);
		if (this.offset > 0 && window[0]?.id && list[this.offset - 1]?.group === window[0].group) {
			const group = groups[window[0].group];
			window[0] = { text: th.fg(group.color, group.name) + th.fg("dim", " · continued"), group: window[0].group };
		}
		if (!list.length) window.push({ text: th.fg("muted", "No sessions in this directory."), group: 0 });
		lines.push(...window.map((line) => line.text));
		while (lines.length < height - detail.length - 4) lines.push("");
		lines.push(...detail, rule);
		const isNew = this.selected === NEW_SESSION;
		const newAction = ends(th.fg("accent", `${isNew ? "›" : " "} + New session`), th.fg("dim", "n to start"));
		lines.push(isNew ? th.bg("userMessageBg", fit(newAction)) : newAction);
		lines.push(th.fg("dim", inner < 48 ? "enter open · space peek · esc" : "↑↓ select   enter open   space peek   esc back"));
		const error = this.actionError || this.error;
		lines.push(error ? th.fg("warning", clean(error)) : "");
		// Full-width padding makes the overlay opaque, including its empty space.
		return lines.slice(0, height).map((line) => "\x1b[0m" + "  " + fit(line));
	}

	invalidate(): void {}
}
