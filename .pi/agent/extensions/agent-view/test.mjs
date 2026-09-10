import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { stripVTControlCharacters } from "node:util";

const packageDir = process.env.PI_PACKAGE_DIR || join(homedir(), ".local/lib/node_modules/@earendil-works/pi-coding-agent");
const require = createRequire(join(packageDir, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { alias: {
	"@earendil-works/pi-coding-agent": join(packageDir, "dist/index.js"),
	"@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
} });
const { canonical, clean, readRows, readSavedRows, saveRow, sessionTitle, storeDir } = await jiti.import("./store.ts");
const { AgentView, age, sortRows, NEW_SESSION } = await jiti.import("./view.ts");
const extension = (await jiti.import("./index.ts")).default;
const { SessionManager } = await import(join(packageDir, "dist/index.js"));
const { visibleWidth } = require("@earendil-works/pi-tui");
const { getThemeByName, initTheme } = await import(join(packageDir, "dist/modes/interactive/theme/theme.js"));
initTheme("light");
const theme = getThemeByName("light");
const now = Date.now();
const row = (id, state = "working") => ({ id, state, cwd: "/project", name: `Agent ${id}`, summary: "Reading src/agent.ts", started: now - 65_000, updated: now, live: true, pid: process.pid });
const createView = (options = {}) => new AgentView(theme, { cwd: "/project", currentId: "current", height: () => 24, redraw() {}, choose() {}, ...options });

const cleanups = new WeakMap();
function temporaryHome(t) {
	const root = mkdtempSync(join(tmpdir(), "agent-view-test-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const callbacks = [];
	cleanups.set(t, callbacks);
	t.after(() => {
		for (const cleanup of callbacks.reverse()) cleanup();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	});
	return root;
}

function runtime(t, ctx) {
	const handlers = new Map();
	const commands = new Map();
	extension({ on: (event, handler) => handlers.set(event, handler), registerCommand: (name, command) => commands.set(name, command) });
	const emit = (name, event = {}) => handlers.get(name)?.(event, ctx);
	cleanups.get(t).push(() => emit("session_shutdown"));
	return { emit, command: (args = "") => commands.get("agents").handler(args, ctx) };
}

function sessionManager(file) {
	return { getBranch: () => [], getSessionId: () => "current", getSessionName: () => "Current", getSessionFile: () => file, getHeader: () => ({ timestamp: new Date(now).toISOString() }) };
}

test("group order, stable ties and frozen duration", () => {
	assert.deepEqual(sortRows([row("d", "completed"), row("b"), row("a", "waiting"), row("c", "idle")]).map(r => r.id), ["a", "b", "c", "d"]);
	assert.equal(age({ ...row("a"), ended: now }, now + 86400_000), "1m");
});

test("terminal text cannot inject escapes or extra rows", () => {
	assert.equal(clean("a\n\x1b[31mred\x1b[0m\x1b]0;title\x07\tb"), "a red b");
	assert.equal(clean("x".repeat(1000)).length, 600);
	assert.equal(sessionTitle("Full title ".repeat(40)), "Full title ".repeat(40).trim());
	assert.equal(sessionTitle(undefined, "x".repeat(1000)).length, 160);
});

test("private storage, directory isolation, symlinks, invalid records and dead processes", t => {
	const root = temporaryHome(t);
	const cwd = join(root, "project");
	mkdirSync(cwd);
	symlinkSync(cwd, join(root, "alias"));
	const dir = storeDir(root, cwd);
	assert.equal(dir, storeDir(root, join(root, "alias")));
	saveRow(dir, { ...row("live"), cwd });
	saveRow(dir, { ...row("dead"), cwd, pid: 2147483647 });
	saveRow(dir, { ...row("stale"), cwd, updated: now - 70_000 });
	saveRow(dir, { ...row("other"), cwd: `${cwd}-other` });
	saveRow(dir, { ...row("invalid"), cwd, ended: "not a number" });
	writeFileSync(join(dir, "broken.json"), "{");
	const rows = readRows(dir, cwd, now);
	assert.equal(statSync(dir).mode & 0o777, 0o700);
	assert.equal(rows.length, 3);
	assert.equal(rows.find(r => r.id === "dead").state, "stopped");
	assert.equal(rows.find(r => r.id === "stale").state, "idle");
	assert.equal(rows.find(r => r.id === "stale").live, true, "expired heartbeat must not allow a second writer");
	assert.equal(rows.find(r => r.id === "live").live, true);
	assert.equal(canonical(join(root, "alias")), canonical(cwd));
});

test("saved sessions stay directory-scoped and never get a guessed live status", async t => {
	const root = temporaryHome(t);
	const other = join(root, "other");
	mkdirSync(other);
	const fullTitle = "Saved title ".repeat(30).trim();
	for (const cwd of [root, other]) {
		const session = SessionManager.create(cwd);
		session.appendMessage({ role: "user", content: "First prompt", timestamp: now });
		session.appendSessionInfo(fullTitle);
		session.appendMessage({ role: "assistant", content: [], timestamp: now, stopReason: "stop" });
	}
	const rows = await readSavedRows(root);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].name, fullTitle);
	assert.equal(rows[0].cwd, canonical(root));
	assert.equal(rows[0].state, "idle");
	assert.equal(rows[0].live, false);
});

test("responsive rendering stays inside the viewport and retains selection on refresh", () => {
	let height = 24;
	let closed = 0;
	const view = createView({ currentId: "0", height: () => height, choose: choice => { if (!choice) closed++; } });
	view.update(Array.from({ length: 70 }, (_, i) => ({ ...row(String(i), ["waiting", "working", "idle", "completed", "failed", "stopped"][i % 6]), name: `日本語 👩‍💻 ${i} ${"long ".repeat(30)}` })));
	for (height of [1, 8, 10, 17, 24, 50]) {
		for (const width of [1, 20, 32, 40, 79, 80, 100, 120]) {
			for (let i = 0; i < 75; i++) {
				view.handleInput("\x1b[B");
				const lines = view.render(width);
				assert.ok(lines.length <= height, `height ${height}, width ${width}`);
				assert.ok(lines.every(line => visibleWidth(line) <= width), `overflow at ${width}`);
			}
		}
	}
	const selected = view.selected;
	view.update([...view.rows].reverse());
	assert.equal(view.selected, selected);
	view.handleInput(" ");
	view.handleInput("\x1b");
	assert.equal(closed, 0);
	view.handleInput("\x1b");
	assert.equal(closed, 1);
});

test("titles use the full row, wrap without truncation, and time ends at the right edge", () => {
	const title = "Fix the connection retry logic without losing in-flight requests while restarting the database. "
		+ "Keep the existing timeout policy and add regression coverage for every failure mode.";
	for (const width of [32, 60, 120]) {
		const view = createView({ height: () => 40 });
		view.update([{ ...row("long"), name: title, summary: "UNIQUE_ACTIVITY", ended: now }]);
		const lines = view.render(width).map(stripVTControlCharacters);
		const first = lines.findIndex(line => line.includes("Fix the"));
		assert.ok(first >= 0);
		assert.ok(lines[first].endsWith("1m"), "time is flush right");
		assert.equal(visibleWidth(lines[first]), width);
		const parts = [];
		for (let i = first; i < lines.length && lines[i].slice(6, -6).trim(); i++) parts.push(lines[i].slice(6, -6).trim());
		assert.equal(parts.join(" "), title, `complete title at ${width} columns`);
		assert.ok(!lines.join("\n").includes("UNIQUE_ACTIVITY"), "activity belongs in peek, not in the list");
		assert.ok(!lines.join("\n").includes("total"));
		assert.ok(!lines.join("\n").includes("1/1"));
		view.handleInput(" ");
		assert.ok(view.render(width).join("\n").includes("UNIQUE_ACTIVITY"));
		assert.ok(view.render(width).join("\n").includes("Latest activity"));
	}
});

test("scrolling keeps the selected wrapped title visible", () => {
	const view = createView({ height: () => 13 });
	view.update([
		...Array.from({ length: 20 }, (_, i) => ({ ...row(`before-${i}`), updated: now + 100 - i })),
		{ ...row("long"), name: "LONG_START " + "detail ".repeat(18) + "TAIL_MARKER", updated: now },
		{ ...row("after"), updated: now - 1 },
	]);
	view.selected = "long";
	const output = view.render(60).map(stripVTControlCharacters).join("\n");
	assert.ok(output.includes("LONG_START"));
	assert.ok(output.includes("TAIL_MARKER"));
});

test("Idle is capped at five, keeps current visible, and does not cap other groups", () => {
	const view = createView({ currentId: "old-current", height: () => 32 });
	const idle = Array.from({ length: 12 }, (_, i) => ({ ...row(`idle-${i}`, "idle"), live: false, updated: now - i }));
	const other = [row("working"), row("waiting", "waiting"), row("done", "completed")];
	const current = { ...row("old-current", "idle"), live: false, updated: 0 };
	view.update([...idle, ...other, current]);
	assert.equal(view.rows.filter(r => r.state === "idle").length, 5);
	assert.equal(view.selected, current.id);
	for (const r of [...idle.slice(0, 4), ...other]) assert.ok(view.rows.some(shown => shown.id === r.id));
	assert.ok(view.render(120).join("\n").includes("5 of 13"));
	view.selected = "idle-3";
	view.update([...idle, ...other, current, { ...row("newest", "idle"), live: false, updated: now + 1000 }]);
	assert.equal(view.rows.filter(r => r.state === "idle").length, 5);
	assert.equal(view.selected, current.id, "hidden selections fall back safely");
});

test("New session is pinned, keyboard selectable, and available in an empty view", () => {
	let created = 0;
	const view = createView({ height: () => 18, choose: choice => { if (choice === NEW_SESSION) created++; } });
	view.update([row("current")]);
	view.handleInput("\x1b[B");
	assert.ok(view.render(60).join("\n").includes("› + New session"));
	view.update([row("current")]);
	view.handleInput("\r");
	assert.equal(created, 1, "refresh retains New session selection");
	view.handleInput("\x1b[A");
	assert.equal(view.selected, "current");
	view.handleInput("n");
	assert.equal(created, 2);
	view.update([]);
	view.handleInput("\r");
	assert.equal(created, 3);
	for (const width of [32, 60, 120]) assert.ok(view.render(width).some(line => line.includes("New session") && line.includes("n to start")));
});

test("lifecycle updates, prompt tracking, shutdown, and late events", async t => {
	const root = temporaryHome(t);
	const ctx = { cwd: root, mode: "print", isIdle: () => true, sessionManager: sessionManager(join(root, "session.jsonl")) };
	const { emit } = runtime(t, ctx);
	const current = () => readRows(storeDir(root, root), root)[0];
	const flush = () => new Promise(resolve => setTimeout(resolve, 200));
	assert.equal(current(), undefined, "factory starts no background resources");
	emit("session_start");
	emit("before_agent_start", { prompt: "New task" });
	emit("agent_start");
	emit("ui_prompt_start", { title: "Allow command?" });
	await flush();
	assert.equal(current().state, "waiting");
	emit("ui_prompt_end");
	for (const [stopReason, state] of [["stop", "completed"], ["error", "failed"], ["aborted", "stopped"], ["", "idle"]]) {
		emit("agent_start");
		emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "Finished" }], stopReason } });
		emit("agent_settled");
		await flush();
		assert.equal(current().state, state);
		assert.equal(current().summary, "Finished");
	}
	emit("session_shutdown");
	const stopped = current();
	emit("ui_prompt_end");
	await flush();
	assert.equal(stopped.live, false);
	assert.deepEqual(current(), stopped, "late events do not publish after shutdown");
});

const cases = [
	["resume", {}, "switch"], ["current", { keys: ["\r"] }], ["cancel", { keys: ["\x1b"] }],
	["busy", { busy: true }, undefined, "response finish"], ["queued", { queued: true }, undefined, "response finish"],
	["draft", { draft: true }, undefined, "draft"], ["live", { live: true }, undefined, "another terminal"],
	["stale", { live: true, stale: true }, undefined, "another terminal"], ["missing", { missing: true }, undefined, "no longer available"],
	["race", { race: true }, undefined, "another terminal"], ["cancelled", { cancelled: true }, "switch"],
	["failure", { failure: true }, "switch", "Operation failed"],
	["new Enter", { keys: ["\x1b[F", "\r"] }, "new"], ["new shortcut", { keys: ["n"] }, "new"],
	["new busy", { keys: ["n"], busy: true }, undefined, "response finish"],
	["new queued", { keys: ["n"], queued: true }, undefined, "response finish"],
	["new draft", { keys: ["n"], draft: true }, undefined, "draft"],
	["new race", { keys: ["n"], race: true }, undefined, "response finish"],
	["new cancelled", { keys: ["n"], cancelled: true }, "new"],
	["new failure", { keys: ["n"], failure: true }, "new", "Operation failed"],
	["unexpected arguments", { args: "unexpected" }, undefined, "Usage: /agents"],
];
for (const [name, options, expected, error] of cases) test(`session action: ${name}`, async t => {
	const root = temporaryHome(t);
	const file = join(root, "saved.jsonl");
	writeFileSync(file, "{}\n");
	const dir = storeDir(root, root);
	const target = { ...row("saved", "completed"), cwd: root, file: options.missing ? file + ".missing" : file,
		live: !!options.live, updated: options.stale ? now - 70_000 : Date.now() };
	saveRow(dir, target);
	const actions = [];
	const notices = [];
	const statuses = [];
	let output = "";
	let becameBusy = false;
	const replace = async (...args) => {
		actions.push(args);
		if (options.failure) throw new Error("Operation failed");
		if (options.cancelled) return { cancelled: true };
		emit("session_shutdown");
		ctx.ui.notify = () => assert.fail("Used a stale context");
		return { cancelled: false };
	};
	const ctx = { cwd: root, mode: "tui", isIdle: () => !options.busy && !becameBusy, hasPendingMessages: () => !!options.queued,
		sessionManager: sessionManager(), newSession: (...args) => replace("new", ...args), switchSession: path => replace("switch", path),
		ui: {
			setStatus: (...args) => statuses.push(args), getEditorText: () => options.draft ? "unsent" : "", notify: text => notices.push(text),
			custom: factory => new Promise(resolve => {
				let closed = false;
				const view = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, {}, selected => {
					if (closed) return;
					closed = true;
					view.dispose();
					if (options.race) {
						if (selected === NEW_SESSION) becameBusy = true;
						else saveRow(dir, { ...target, live: true });
					}
					resolve(selected);
				});
				queueMicrotask(() => {
					for (const key of options.keys ?? ["\x1b[B", "\r"]) view.handleInput(key);
					output = view.render(120).join("\n");
					if (!closed) view.handleInput("\x1b");
				});
			}),
		},
	};
	const { emit, command } = runtime(t, ctx);
	emit("session_start");
	await command(options.args);
	assert.ok(!readRows(dir, root).some(row => row.id === "current"), "ephemeral session stays in memory");
	assert.deepEqual(statuses, [["agent-view", undefined]]);
	assert.deepEqual(actions, expected === "switch" ? [["switch", file]] : expected === "new" ? [["new"]] : []);
	if (error) assert.ok((output + notices.join("\n")).includes(error), error);
});
