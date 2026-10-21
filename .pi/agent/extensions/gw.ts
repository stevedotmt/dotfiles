/**
 * /gw - switch pi to another git worktree
 *
 * Mirrors ~/.config/fish/functions/gw.fish:
 * - Inside a repo: lists that repo's worktrees (`git worktree list`).
 * - Outside a repo: lists every <worktreeBaseDir>/<repo>/<name> directory.
 *
 * Picking one starts a NEW, EMPTY session whose cwd is the chosen worktree
 * (pi's cwd is bound to the session, so this is the only way to move). The
 * current session is left untouched and stays resumable from its own cwd.
 *
 * Usage:
 *   /gw            open the picker
 *   /gw <filter>   skip the picker when exactly one label matches <filter>
 *
 * `worktreeBaseDir` is read from the pi-subagents config so it shares one
 * source of truth with git-worktree-conventions.ts.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const SUBAGENT_CONFIG = join(homedir(), ".pi/agent/extensions/subagent/config.json");
const DEFAULT_BASE = join(homedir(), "code/.worktrees");

interface Entry {
	label: string;
	path: string;
	branch: string;
}

function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

function loadBaseDir(): string {
	try {
		const raw = JSON.parse(readFileSync(SUBAGENT_CONFIG, "utf8"));
		if (typeof raw.worktreeBaseDir === "string") return resolve(expandHome(raw.worktreeBaseDir));
	} catch {
		// no/invalid config -> default
	}
	return DEFAULT_BASE;
}

function git(cwd: string, ...args: string[]): string | undefined {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function branchOf(path: string): string {
	const b = git(path, "rev-parse", "--abbrev-ref", "HEAD");
	return b && b !== "HEAD" ? b : (git(path, "rev-parse", "--short", "HEAD") ?? "?");
}

/** Worktrees of the repo containing `cwd`, or undefined when not in a repo. */
function repoWorktrees(cwd: string, base: string): Entry[] | undefined {
	// From a worktree, --git-common-dir still points at the main checkout's
	// .git, so its dirname is the main checkout root regardless of cwd.
	const common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
	if (!common) return undefined;
	const mainRoot = resolve(common, "..");
	const repoName = basename(mainRoot);
	const porcelain = git(cwd, "worktree", "list", "--porcelain") ?? "";
	const entries: Entry[] = [];
	for (const line of porcelain.split("\n")) {
		const m = /^worktree (.+)$/.exec(line);
		if (!m) continue;
		const wt = m[1];
		let label: string;
		if (wt === mainRoot) label = `${repoName}/(main checkout)`;
		else if (wt.startsWith(`${base}/${repoName}/`)) label = wt.slice(base.length + 1);
		else label = wt;
		entries.push({ label, path: wt, branch: branchOf(wt) });
	}
	return entries;
}

/** All <base>/<repo>/<name> directories. */
function allWorktrees(base: string): Entry[] {
	const entries: Entry[] = [];
	if (!existsSync(base)) return entries;
	for (const repo of readdirSync(base, { withFileTypes: true })) {
		if (!repo.isDirectory()) continue;
		const repoDir = join(base, repo.name);
		for (const wt of readdirSync(repoDir, { withFileTypes: true })) {
			if (!wt.isDirectory()) continue;
			const path = join(repoDir, wt.name);
			entries.push({ label: `${repo.name}/${wt.name}`, path, branch: branchOf(path) });
		}
	}
	return entries.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Create a session file for `cwd` and write its header immediately.
 *
 * SessionManager.create() defers writing until the first assistant reply, but
 * ctx.switchSession() reads the cwd from the on-disk header and falls back to
 * process.cwd() when the file is missing - so we must flush the header first.
 */
function createSessionFileFor(cwd: string): string {
	const sm = SessionManager.create(cwd);
	const file = sm.getSessionFile();
	const header = sm.getHeader();
	if (!file || !header) throw new Error(`could not create session for ${cwd}`);
	writeFileSync(file, `${JSON.stringify(header)}\n`, { flag: "wx" });
	return file;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("gw", {
		description: "Switch to another git worktree (new empty session in that directory)",
		handler: async (args, ctx) => {
			const base = loadBaseDir();
			const current = resolve(ctx.cwd);
			const entries = repoWorktrees(current, base) ?? allWorktrees(base);
			if (entries.length === 0) {
				ctx.ui.notify("No worktrees found", "warning");
				return;
			}

			const display = (e: Entry) => `${e.label}  [${e.branch}]${resolve(e.path) === current ? "  (current)" : ""}`;

			let target: Entry | undefined;
			const filter = args?.trim();
			if (filter) {
				const matches = entries.filter((e) => e.label.toLowerCase().includes(filter.toLowerCase()));
				if (matches.length === 1) target = matches[0];
				else if (matches.length === 0) {
					ctx.ui.notify(`No worktree matches "${filter}"`, "warning");
					return;
				}
				// multiple matches: fall through to picker with the filtered list
				if (!target) {
					const choice = await ctx.ui.select("worktree>", matches.map(display));
					target = matches.find((e) => display(e) === choice);
				}
			} else {
				const choice = await ctx.ui.select("worktree>", entries.map(display));
				target = entries.find((e) => display(e) === choice);
			}

			if (!target) return;
			if (resolve(target.path) === current) {
				ctx.ui.notify("Already in that worktree", "info");
				return;
			}

			const dest = target.path;
			const sessionFile = createSessionFileFor(dest);
			await ctx.switchSession(sessionFile, {
				withSession: async (ctx) => {
					ctx.ui.notify(`Now in ${dest}`, "info");
				},
			});
		},
	});
}
