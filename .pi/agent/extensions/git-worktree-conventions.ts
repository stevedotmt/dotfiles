/**
 * Git Worktree Conventions
 *
 * Rewrites ad-hoc `git worktree add` bash commands so every worktree follows
 * the same convention as pi-subagents managed worktrees:
 *
 *   <worktreeBaseDir>/<repo-name>/<basename-of-requested-path>
 *
 * and appends the pi-subagents worktree setup hook (chained with &&) so ad-hoc
 * worktrees get the same setup (e.g. .env copying) as managed ones.
 *
 * - Only `git worktree add` is rewritten; list/remove/prune/... pass through.
 * - Paths already inside <baseDir>/<repo-name> are kept (hook still appended).
 * - Parse uncertainty leaves the command untouched (fail open).
 * - `worktreeBaseDir` / `worktreeSetupHook` are read from the pi-subagents
 *   config so there is one source of truth.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SUBAGENT_CONFIG = join(homedir(), ".pi/agent/extensions/subagent/config.json");
const DEFAULT_HOOK = join(homedir(), ".pi/agent/scripts/subagent-worktree-setup.mjs");
const DEFAULT_BASE = join(homedir(), "code/.worktrees");

// git global flags that consume a separate argument before the subcommand
const GIT_FLAGS_WITH_ARGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
// `git worktree add` flags that consume a separate argument
const ADD_FLAGS_WITH_ARGS = new Set(["-b", "-B", "--reason", "--orphan"]);

interface WorktreeConfig {
	baseDir: string;
	hook: string;
}

function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

function loadConfig(): WorktreeConfig {
	const cfg: WorktreeConfig = { baseDir: DEFAULT_BASE, hook: DEFAULT_HOOK };
	try {
		const raw = JSON.parse(readFileSync(SUBAGENT_CONFIG, "utf8"));
		if (typeof raw.worktreeBaseDir === "string") cfg.baseDir = resolve(expandHome(raw.worktreeBaseDir));
		if (typeof raw.worktreeSetupHook === "string") cfg.hook = expandHome(raw.worktreeSetupHook);
	} catch {
		// no/invalid config -> defaults
	}
	return cfg;
}

/** Shell-quote a single word. */
function q(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface Token {
	/** Original text including any quotes (used when rebuilding the command). */
	raw: string;
	/** Unquoted value (used for detection/parsing). */
	value: string;
}

/** Minimal shell tokenizer: splits on whitespace outside single/double quotes. */
function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let raw = "";
	let value = "";
	let inSingle = false;
	let inDouble = false;
	let started = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (inSingle) {
			raw += ch;
			if (ch === "'") inSingle = false;
			else value += ch;
			continue;
		}
		if (inDouble) {
			raw += ch;
			if (ch === '"') inDouble = false;
			else value += ch;
			continue;
		}
		if (ch === "'") {
			raw += ch;
			inSingle = true;
			started = true;
		} else if (ch === '"') {
			raw += ch;
			inDouble = true;
			started = true;
		} else if (/\s/.test(ch)) {
			if (started) tokens.push({ raw, value });
			raw = "";
			value = "";
			started = false;
		} else {
			raw += ch;
			value += ch;
			started = true;
		}
	}
	if (started) tokens.push({ raw, value });
	return tokens;
}

function repoRootFor(cwd: string): string | undefined {
	try {
		return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

/**
 * If the segment is a bare `cd <dir>`, return the new absolute cwd it would
 * produce; otherwise undefined. `cd` with no args goes home; extra args fail
 * open (left untouched).
 */
function parseBareCd(segment: string, cwd: string): string | undefined {
	const tokens = tokenize(segment);
	if (tokens.length === 0 || tokens[0].value !== "cd") return undefined;
	if (tokens.length === 1) return homedir();
	if (tokens.length !== 2) return undefined;
	const target = expandHome(tokens[1].value);
	return isAbsolute(target) ? target : resolve(cwd, target);
}

/**
 * Rewrite one command segment (text between &&, ||, ;, |).
 * Returns the rewritten segment, or undefined when nothing applies.
 */
function transformSegment(segment: string, cwd: string, cfg: WorktreeConfig): string | undefined {
	const leading = segment.match(/^\s*/)?.[0] ?? "";
	const tokens = tokenize(segment);
	if (tokens.length === 0) return undefined;

	// Values with subshell wrappers stripped, for detection only
	const vals = tokens.map((t) => t.value.replace(/^[($`]+/, ""));

	const gitIdx = vals.findIndex((v) => v === "git" || v.endsWith("/git"));
	if (gitIdx === -1) return undefined;

	// Skip git global flags, capturing -C (changes the repo cwd)
	let i = gitIdx + 1;
	let cDir: string | undefined;
	while (i < vals.length) {
		const v = vals[i];
		if (v === "-C") {
			cDir = vals[i + 1];
			i += 2;
			continue;
		}
		if (v.startsWith("-C") && v.length > 2) {
			cDir = v.slice(2);
			i++;
			continue;
		}
		if (GIT_FLAGS_WITH_ARGS.has(v)) {
			i += 2;
			continue;
		}
		if (v.startsWith("-")) {
			i++;
			continue;
		}
		break;
	}

	if (vals[i] !== "worktree" || vals[i + 1] !== "add") return undefined;
	i += 2;

	// Parse `git worktree add` args: collect positionals and the branch name
	const positionals: { idx: number; value: string }[] = [];
	let branch = "";
	let onlyPositional = false;
	for (let j = i; j < vals.length; j++) {
		const v = vals[j];
		if (!onlyPositional && v === "--") {
			onlyPositional = true;
			continue;
		}
		if (!onlyPositional && ADD_FLAGS_WITH_ARGS.has(v)) {
			if (v === "-b" || v === "-B" || v === "--orphan") branch = vals[j + 1] ?? "";
			j++; // skip the flag's argument
			continue;
		}
		if (!onlyPositional && v.startsWith("-b") && !v.startsWith("--") && v.length > 2) {
			branch = v.slice(2); // attached form: -bfeat/x
			continue;
		}
		if (!onlyPositional && v.startsWith("-")) continue; // boolean flags, incl. --flag=value
		positionals.push({ idx: j, value: v });
	}

	if (positionals.length === 0) return undefined;
	const pathTok = positionals[0];
	const requestedPath = pathTok.value.replace(/\/+$/, "");
	const leaf = basename(requestedPath);
	if (!leaf || leaf === "." || leaf === "..") return undefined;

	// `git -C <dir>` may be relative; resolve it against the effective cwd
	let repoDir = cwd;
	if (cDir !== undefined) {
		const expanded = expandHome(cDir);
		repoDir = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
	}
	const repoRoot = repoRootFor(repoDir);
	if (!repoRoot) return undefined;
	const repoName = basename(repoRoot);
	const targetParent = join(cfg.baseDir, repoName);

	// Final absolute path the worktree will live at
	let finalPath: string;
	if (isAbsolute(requestedPath) && requestedPath.startsWith(targetParent + sep)) {
		finalPath = requestedPath; // already compliant
	} else {
		finalPath = join(targetParent, leaf);
		tokens[pathTok.idx] = { raw: q(finalPath), value: finalPath };
	}

	const hookPayload = JSON.stringify({
		repoRoot,
		worktreePath: finalPath,
		agentCwd: cwd,
		branch,
		index: 0,
		runId: "adhoc-bash",
		baseCommit: "",
	});

	const rebuilt = leading + tokens.map((t) => t.raw).join(" ");
	return `${rebuilt} && printf '%s' ${q(hookPayload)} | node ${q(cfg.hook)} >/dev/null`;
}

/** Exported for testing: rewrite a full bash command, or return it unchanged. */
export function rewriteCommand(command: string, cwd: string, cfg: WorktreeConfig = loadConfig()): string {
	// Split preserving separators so we can reassemble exactly
	const parts = command.split(/(&&|\|\||[;|])/);
	// Track the effective cwd across segments: a bare `cd <dir> &&` prefix
	// changes which repo a later `git worktree add` operates on.
	let effectiveCwd = cwd;
	for (let k = 0; k < parts.length; k += 2) {
		const cdTarget = parseBareCd(parts[k], effectiveCwd);
		if (cdTarget !== undefined) {
			effectiveCwd = cdTarget;
			continue;
		}
		const rewritten = transformSegment(parts[k], effectiveCwd, cfg);
		if (rewritten !== undefined) parts[k] = rewritten;
	}
	return parts.join("");
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "bash") return;
		const input = event.input as { command: string };
		const rewritten = rewriteCommand(input.command, ctx.cwd);
		if (rewritten !== input.command) input.command = rewritten;
	});
}
