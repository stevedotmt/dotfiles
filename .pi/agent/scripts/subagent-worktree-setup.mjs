#!/usr/bin/env node
/**
 * pi-subagents worktree setup hook (global).
 *
 * Contract (see pi-subagents docs/configuration.md):
 *   stdin:  one JSON object { repoRoot, worktreePath, agentCwd, branch, index, runId, baseCommit }
 *   stdout: one JSON object, e.g. { "syntheticPaths": [".env"] }
 *
 * Runs once per created worktree. Hook failure fails the entire worktree run,
 * so this script is deliberately defensive: it logs problems to stderr and
 * always exits 0 with valid JSON.
 *
 * What it does: fresh worktrees only contain tracked files, so untracked local
 * config (.env, .env.local, .env.*.local) is missing. We copy those files from
 * the main repo root into the worktree and mark them synthetic so pi-subagents
 * removes them again before patch capture.
 *
 * Tracked files are never copied (they already exist in the worktree, and
 * marking a tracked path synthetic fails setup).
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

function isTracked(repoRoot, path) {
	try {
		execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: repoRoot, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function main() {
	const syntheticPaths = [];

	let payload;
	try {
		payload = JSON.parse(readStdinBuffer);
	} catch (err) {
		console.error(`worktree-setup: bad stdin JSON: ${err.message}`);
		return { syntheticPaths };
	}

	const { repoRoot, worktreePath } = payload;
	if (!repoRoot || !worktreePath) {
		console.error("worktree-setup: payload missing repoRoot/worktreePath");
		return { syntheticPaths };
	}

	// Candidate env files: fixed names plus any .env.*.local present in the repo root.
	const candidates = [".env", ".env.local"];
	try {
		for (const entry of readdirSync(repoRoot)) {
			if (/^\.env\..*\.local$/.test(entry)) candidates.push(entry);
		}
	} catch (err) {
		console.error(`worktree-setup: cannot read repoRoot: ${err.message}`);
	}

	for (const name of candidates) {
		try {
			const src = join(repoRoot, name);
			if (!existsSync(src) || isTracked(repoRoot, name)) continue;
			const dest = join(worktreePath, name);
			mkdirSync(dirname(dest), { recursive: true });
			copyFileSync(src, dest);
			chmodSync(dest, 0o600);
			syntheticPaths.push(name);
		} catch (err) {
			console.error(`worktree-setup: failed to copy ${name}: ${err.message}`);
		}
	}

	if (syntheticPaths.length > 0) {
		console.error(`worktree-setup: copied into worktree: ${syntheticPaths.join(", ")}`);
	}
	return { syntheticPaths };
}

const readStdinBuffer = await readStdin();
let result;
try {
	result = main();
} catch (err) {
	console.error(`worktree-setup: unexpected error: ${err?.message ?? err}`);
	result = { syntheticPaths: [] };
}
process.stdout.write(JSON.stringify(result));
