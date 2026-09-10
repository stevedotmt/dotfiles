import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export type State = "waiting" | "working" | "idle" | "completed" | "failed" | "stopped";
export interface AgentRow {
	id: string;
	cwd: string;
	name: string;
	summary: string;
	state: State;
	started: number;
	updated: number;
	ended?: number;
	pid?: number;
	live: boolean;
	file?: string;
}

// Never let session text inject terminal escapes or extra rows.
export function clean(text: string, limit = 600): string {
	return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
		.replace(/\s+/g, " ").trim().slice(0, limit);
}

// Preserve explicit session names; only prompts used as fallback titles need shortening.
export function sessionTitle(name: string | undefined, fallback = "New session"): string {
	return name ? clean(name, name.length) : clean(fallback, 160);
}

export function canonical(cwd: string): string {
	try { return realpathSync(cwd); } catch { return resolve(cwd); }
}

export function storeDir(root: string, cwd: string): string {
	return join(root, "agent-view", createHash("sha256").update(canonical(cwd)).digest("hex").slice(0, 24));
}

export function saveRow(dir: string, row: AgentRow): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const key = createHash("sha256").update(row.id).digest("hex");
	const file = join(dir, `${key}.json`);
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify({ ...row, cwd: canonical(row.cwd) }), { mode: 0o600 });
	renameSync(temp, file);
}

function isAlive(pid: number | undefined): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function readRows(dir: string, cwd: string, now = Date.now()): AgentRow[] {
	const scope = canonical(cwd);
	let files: string[];
	try { files = readdirSync(dir); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const rows: AgentRow[] = [];
	for (const file of files.filter((file) => file.endsWith(".json"))) {
		try {
			const row = JSON.parse(readFileSync(join(dir, file), "utf8")) as AgentRow;
			if (row.cwd !== scope || typeof row.id !== "string" || typeof row.name !== "string"
				|| typeof row.summary !== "string" || typeof row.live !== "boolean"
				|| !Number.isFinite(row.started) || !Number.isFinite(row.updated)
				|| (row.ended !== undefined && !Number.isFinite(row.ended))
				|| (row.file !== undefined && typeof row.file !== "string")
				|| !["waiting", "working", "idle", "completed", "failed", "stopped"].includes(row.state)) continue;
			if (row.live) {
				// An expired heartbeat is not proof that a second writer can safely resume this session.
				row.live = isAlive(row.pid);
				if ((!row.live || now - row.updated > 60_000) && (row.state === "working" || row.state === "waiting")) {
					row.state = row.live ? "idle" : "stopped";
					row.summary = row.live ? "Status unavailable · heartbeat expired" : "Process exited before the turn finished";
					row.ended = row.updated;
				}
			}
			rows.push(row);
		} catch { /* Ignore partial or obsolete records from another process. */ }
	}
	return rows;
}

export async function readSavedRows(cwd: string): Promise<AgentRow[]> {
	const scope = canonical(cwd);
	const sessions = await SessionManager.list(cwd);
	return sessions.filter((session) => canonical(session.cwd) === scope).map((session) => ({
		id: session.id, cwd: scope, file: session.path,
		name: sessionTitle(session.name, session.firstMessage || "Untitled session"),
		summary: "Saved session · live status unavailable", state: "idle", live: false,
		started: session.created.getTime(), updated: session.modified.getTime(), ended: session.modified.getTime(),
	}));
}
