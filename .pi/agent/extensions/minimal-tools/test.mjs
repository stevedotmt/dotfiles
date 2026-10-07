/**
 * Run after Pi upgrades:
 *   node ~/.pi/agent/extensions/minimal-tools/test.mjs
 *
 * Uses the npm Pi installation on PATH (or pass its package directory as argv[2]).
 * Tests run in a separate process with temporary files and mocked nested tools;
 * they do not load personal settings, connect MCP servers, or call providers.
 * Pi internals are imported only here to exercise its actual loader and renderer.
 * An import failure after an upgrade is a failed compatibility check, not a skip.
 */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

async function packageRoot(start) {
	for (let dir = dirname(start); ; dir = dirname(dir)) {
		try {
			const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
			if (manifest.name === "@earendil-works/pi-coding-agent") return dir;
		} catch (error) {
			if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
		}
		if (dirname(dir) === dir) return undefined;
	}
}

async function findPi() {
	if (process.argv[2]) {
		const dir = resolve(process.argv[2]);
		const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
		assert.equal(manifest.name, "@earendil-works/pi-coding-agent");
		return dir;
	}
	const require = createRequire(import.meta.url);
	try {
		const root = await packageRoot(require.resolve("@earendil-works/pi-coding-agent"));
		if (root) return root;
	} catch (error) {
		if (error.code !== "MODULE_NOT_FOUND") throw error;
	}
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		const executable = join(directory, "pi");
		try {
			await access(executable, constants.X_OK);
			const root = await packageRoot(await realpath(executable));
			if (root) return root;
		} catch (error) {
			if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
		}
	}
	throw new Error("Cannot locate npm Pi. Put pi on PATH or pass its package directory as argv[2].");
}

const root = await findPi();
const piImport = (path) => import(pathToFileURL(join(root, path)).href);
const pi = await piImport("dist/index.js");
const { loadExtensions, loadExtensionFromFactory } = await piImport("dist/core/extensions/loader.js");
const { createEventBus } = await piImport("dist/core/event-bus.js");
const { ToolExecutionComponent } = await piImport("dist/modes/interactive/components/tool-execution.js");
const { initTheme } = await piImport("dist/modes/interactive/theme/theme.js");
const piRequire = createRequire(join(root, "package.json"));
const { visibleWidth } = await import(pathToFileURL(piRequire.resolve("@earendil-works/pi-tui")).href);
const extensionPath = fileURLToPath(new URL("./index.ts", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "minimal-tools-test-"));
after(() => rm(temporary, { recursive: true, force: true }));
initTheme("dark", false);
console.log(`Testing against Pi ${JSON.parse(await readFile(join(root, "package.json"), "utf8")).version}`);

const factories = {
	read: (cwd, s) => pi.createReadToolDefinition(cwd, { autoResizeImages: s.getImageAutoResize() }),
	bash: (cwd, s) => pi.createBashToolDefinition(cwd, {
		commandPrefix: s.getShellCommandPrefix(), shellPath: s.getShellPath(),
	}),
	grep: (cwd) => pi.createGrepToolDefinition(cwd),
	find: (cwd) => pi.createFindToolDefinition(cwd),
	ls: (cwd) => pi.createLsToolDefinition(cwd),
};
const dataFields = (tool) => JSON.parse(JSON.stringify(tool));
const textOf = (result) => result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
const strip = (lines) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

async function fixture(t, settings = {}) {
	const cwd = await mkdtemp(join(temporary, "case-"));
	const loaded = await loadExtensions([extensionPath], cwd);
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	const extension = loaded.extensions[0];
	let currentSettings = settings;
	const entries = [];
	const runtime = loaded.runtime;
	runtime.getSettings = () => currentSettings;
	runtime.appendEntry = (customType, data) => entries.push({ type: "custom", customType, data });
	const namespace = { name: "mcp__test", description: "Fixture tools", instructions: "Read-only fixture" };
	runtime.getAllTools = () => [{ name: "probe", namespace }];
	const native = await loadExtensionFromFactory(pi.createCodemodeExtension(), cwd, createEventBus(), runtime);
	const start = async () => {
		for (const handler of extension.handlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, { cwd, hasUI: false });
		}
	};
	await start();
	return {
		cwd, entries, extension, native, start,
		tool: (name) => extension.tools.get(name).definition,
		setSettings: (settings) => { currentSettings = settings; },
	};
}

function toolContext(cwd) {
	return {
		cwd,
		model: { provider: "fixture", id: "fixture-model", input: ["text", "image"] },
		thinkingLevel: "high",
		sessionManager: { getSessionId: () => "fixture-session", getSessionFile: () => undefined },
	};
}

function row(definition, args, cwd) {
	const component = new ToolExecutionComponent(
		definition.name, "fixture-call", args, { showImages: false }, definition,
		{ requestRender() {} }, cwd,
	);
	component.setArgsComplete();
	component.markExecutionStarted();
	return component;
}

const codeArgs = { code: "const greeting = 'hello';\n" + Array.from({ length: 30 }, (_, i) => `text(${i});`).join("\n") };
const successful = {
	content: [
		{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
		{ type: "text", text: "SUCCESS OUTPUT" },
	],
	details: { calls: [{ id: "fixture/1", name: "probe", args: "{}", status: "ok", durationMs: 1 }] },
	isError: false,
};

function nestedContext(f, isError = false) {
	const invoked = [];
	return {
		invoked,
		tools: [{ name: "probe", label: "probe", description: "Fixture probe", parameters: { type: "object", properties: {} } }],
		sessionManager: { getBranch: () => f.entries },
		modelRegistry: { getModelsOfType: () => [{ type: "classifier", provider: "fixture", id: "fixture" }] },
		executeTool: async (name, args, options) => {
			invoked.push({ name, args, signal: options.signal });
			return {
				toolCall: { id: "fixture/1" }, isError,
				result: { content: [{ type: "text", text: isError ? "Fixture permission denied" : "nested result" }], details: undefined },
			};
		},
	};
}

const executeScript = (f, code, ctx, onUpdate, signal) => f.tool("codemode").execute(
	"fixture", { code: `// @options: {"timeout_ms": 5000}\n${code}` }, signal, onUpdate, ctx,
);

// Freeze model-facing results to ensure rendering never changes content or details.
function freezeDeep(value) {
	if (value && typeof value === "object") {
		Object.freeze(value);
		for (const child of Object.values(value)) freezeDeep(child);
	}
	return value;
}

test("model-facing definitions match Pi; no context/result interception; edit/write remain native", async (t) => {
	const f = await fixture(t);
	assert.deepEqual([...f.extension.tools.keys()].sort(), [...Object.keys(factories), "codemode"].sort());
	for (const [name, factory] of Object.entries(factories)) {
		const original = factory(f.cwd, pi.SettingsManager.inMemory());
		assert.deepEqual(dataFields(f.tool(name)), { ...dataFields(original), defaultActive: false }, name);
		assert.equal(f.tool(name).parameters, original.parameters, `${name} schema identity`);
	}
	const original = f.native.tools.get("codemode").definition;
	assert.deepEqual(dataFields(f.tool("codemode")), dataFields(original));
	assert.equal(f.tool("codemode").parameters, original.parameters);
	assert.deepEqual([...f.extension.handlers.keys()].sort(), [...new Set([...f.native.handlers.keys(), "session_start"])].sort());
});

test("file tools return native results in two working directories", async (t) => {
	const f = await fixture(t);
	for (const marker of ["first", "second"]) {
		const cwd = join(f.cwd, marker);
		await mkdir(cwd);
		await writeFile(join(cwd, "fixture.txt"), `${marker}\nneedle\nlast\n`);
		const cases = {
			read: { path: "fixture.txt", offset: 2, limit: 1 },
			bash: { command: "pwd; printf 'fixture output\\n'", timeout: 5 },
			grep: { pattern: "needle", path: "." },
			find: { pattern: "*.txt", path: "." },
			ls: { path: "." },
		};
		for (const [name, args] of Object.entries(cases)) {
			const original = factories[name](cwd, pi.SettingsManager.inMemory());
			const result = await f.tool(name).execute("fixture", args, undefined, undefined, toolContext(cwd));
			const expected = await original.execute("fixture", args, undefined, undefined, toolContext(cwd));
			assert.deepEqual(result, expected, name);
			const compact = row(f.tool(name), args, cwd);
			compact.updateResult({ ...result, isError: false });
			assert.equal(compact.render(100).filter((line) => strip([line]).trim()).length, 1, `${name} collapsed`);
			compact.setExpanded(true);
			const native = row(original, args, cwd);
			native.updateResult({ ...expected, isError: false });
			native.setExpanded(true);
			assert.deepEqual(compact.render(100), native.render(100), `${name} expanded`);
		}
	}
});

test("Codemode scripts receive read's image block through the wrapped definition", async (t) => {
	const f = await fixture(t);
	const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
	await writeFile(join(f.cwd, "pixel.png"), Buffer.from(pixel, "base64"));
	const read = f.tool("read");
	const args = { path: "pixel.png" };
	const direct = await read.execute("fixture", args, undefined, undefined, toolContext(f.cwd));
	const native = await factories.read(f.cwd, pi.SettingsManager.inMemory()).execute("fixture", args, undefined, undefined, toolContext(f.cwd));
	assert.deepEqual(direct, native);
	assert.ok(read.outputSchema, "read keeps outputSchema");
	assert.equal(direct.structuredContent?.type, "image");

	const ctx = {
		...nestedContext(f),
		tools: [read],
		executeTool: async (name, nestedArgs, options) => ({
			toolCall: { id: "fixture/1" }, isError: false,
			result: await read.execute("fixture/1", nestedArgs, options.signal, undefined, toolContext(f.cwd)),
		}),
	};
	const result = await executeScript(f, 'const r = await tools.read({ path: "pixel.png" }); text(JSON.stringify({ type: r.type, mimeType: r.mimeType, note: r.note })); image(r);', ctx);
	assert.ok(!result.isError, textOf(result));
	const { type, data, mimeType, note } = direct.structuredContent;
	assert.ok(textOf(result).includes(JSON.stringify({ type, mimeType, note })), textOf(result));
	const images = result.content.filter((item) => item.type === "image");
	assert.deepEqual(images.map((item) => ({ data: item.data, mimeType: item.mimeType })), [{ data, mimeType }]);
	const saved = textOf(result).match(/Image saved to (\S+)/)?.[1];
	assert.ok(saved, "image() names its temp file");
	await rm(saved, { force: true });
});

test("collapsed truncation keeps the row background", async (t) => {
	const f = await fixture(t);
	const compact = row(f.tool("bash"), { command: `echo ${"a".repeat(200)}` }, f.cwd);
	for (const width of [40, 80]) {
		const line = compact.render(width).find((l) => strip([l]).includes("…"));
		assert.ok(line, `truncated at ${width}`);
		assert.equal(visibleWidth(line), width);
		assert.doesNotMatch(line.slice(0, line.lastIndexOf("\x1b[49m")), /\x1b\[0?m|\x1b\[49m/, `background cleared mid-row at ${width}`);
	}
});

test("execution uses current shell settings and forwards streaming updates", async (t) => {
	const f = await fixture(t);
	const settings = { shellPath: "/bin/sh", shellCommandPrefix: "export MINIMAL_TOOLS_FIXTURE=present;" };
	f.setSettings(settings);
	await f.start();
	const args = { command: 'printf "%s\\n" "$MINIMAL_TOOLS_FIXTURE" "$PI_SESSION_ID" "$PI_PROVIDER" "$PI_MODEL" "$PI_REASONING_LEVEL"; pwd', timeout: 5 };
	const updates = [];
	const actual = await f.tool("bash").execute("fixture", args, undefined, (update) => updates.push(update), toolContext(f.cwd));
	const expected = await factories.bash(f.cwd, pi.SettingsManager.inMemory(settings)).execute("fixture", args, undefined, undefined, toolContext(f.cwd));
	assert.deepEqual(actual, expected);
	assert.match(textOf(actual), /present\nfixture-session\nfixture\nfixture-model\nhigh/);
	assert.ok(updates.length > 0);
});

test("file-tool errors and abort signals propagate", async (t) => {
	const f = await fixture(t);
	const tool = f.tool("read");
	await assert.rejects(tool.execute("fixture", { path: "missing.txt" }, undefined, undefined, { cwd: f.cwd }), /ENOENT/);
	const signal = AbortSignal.abort();
	await assert.rejects(tool.execute("fixture", { path: "missing.txt" }, signal, undefined, { cwd: f.cwd }), /abort/i);
	const failed = row(tool, { path: "missing.txt" }, f.cwd);
	failed.updateResult({ content: [{ type: "text", text: "Fixture read failed" }], isError: true });
	assert.match(strip(failed.render(80)), /Fixture read failed/);
});

test("Codemode collapsed/streaming views are compact and expansion is native", async (t) => {
	const f = await fixture(t);
	const result = freezeDeep(structuredClone(successful));
	const compact = row(f.tool("codemode"), codeArgs, f.cwd);
	compact.updateResult(result);
	for (const width of [20, 80, 140]) {
		const rendered = compact.render(width);
		assert.match(strip(rendered), /codem/);
		assert.doesNotMatch(strip(rendered), /greeting|SUCCESS OUTPUT|probe/);
		assert.equal(rendered.filter((line) => strip([line]).trim()).length, 1);
		assert.ok(rendered.every((line) => visibleWidth(line) <= width));
	}
	const native = row(f.native.tools.get("codemode").definition, codeArgs, f.cwd);
	native.updateResult(result);
	compact.setExpanded(true);
	native.setExpanded(true);
	assert.deepEqual(compact.render(80), native.render(80));
	compact.setExpanded(false);
	assert.doesNotMatch(strip(compact.render(80)), /SUCCESS OUTPUT/);
	compact.updateResult({ content: [], details: { calls: [{ ...successful.details.calls[0], status: "running" }] }, isError: false }, true);
	assert.doesNotMatch(strip(compact.render(80)), /probe/);
});

test("caught failures, cancellations, and script errors stay visible without changing results", async (t) => {
	const f = await fixture(t);
	const result = freezeDeep({
		...structuredClone(successful),
		details: { calls: [
			{ id: "fixture/2", name: "failed_probe", args: "{}", status: "error", error: "Permission denied\nMore details" },
			...Array.from({ length: 10 }, (_, i) => ({ ...successful.details.calls[0], id: `fixture/${i + 3}` })),
		] },
	});
	const before = JSON.stringify(result);
	const compact = row(f.tool("codemode"), codeArgs, f.cwd);
	compact.updateResult(result);
	assert.match(strip(compact.render(80)), /failed_probe/);
	assert.match(strip(compact.render(80)), /Permission denied/);
	assert.match(strip(compact.render(80)), /More details/);
	assert.doesNotMatch(strip(compact.render(80)), /SUCCESS OUTPUT/);
	compact.setExpanded(true);
	assert.match(strip(compact.render(80)), /SUCCESS OUTPUT/);
	compact.setExpanded(false);
	assert.match(strip(compact.render(80)), /Permission denied/);
	assert.equal(JSON.stringify(result), before);
	compact.updateResult({ ...successful, details: { calls: [{ ...successful.details.calls[0], status: "cancelled" }] } });
	assert.match(strip(compact.render(80)), /probe/);
	compact.updateResult({ content: [{ type: "text", text: "Script error: exploded" }], details: { calls: [] }, isError: true });
	assert.match(strip(compact.render(80)), /exploded/);
});

test("Codemode uses nested execution, discovery/model globals, updates, and branch-local store", async (t) => {
	const f = await fixture(t);
	const ctx = nestedContext(f);
	const updates = [];
	const result = await executeScript(f, 'store("answer", 42); return { value: await tools.probe({}), matches: await searchTools("probe"), namespace: await describeNamespace("test"), models: await models.getModelsOfType("classifier") };', ctx, (update) => updates.push(update));
	assert.ok(!result.isError, textOf(result));
	assert.equal(result.details.calls[0].status, "ok");
	assert.equal(ctx.invoked.length, 1);
	assert.equal(ctx.invoked[0].name, "probe");
	assert.ok(ctx.invoked[0].signal instanceof AbortSignal);
	assert.ok(updates.length >= 2);
	assert.match(textOf(result), /nested result/);
	assert.match(textOf(result), /Read-only fixture/);
	assert.match(textOf(result), /classifier/);
	assert.equal(f.entries[0].data.set.answer, 42);
	assert.equal(textOf(await executeScript(f, 'return load("answer");', ctx)).split("\n").at(-1), "42");
	const otherBranch = { ...ctx, sessionManager: { getBranch: () => [] } };
	assert.equal((await executeScript(f, 'return load("answer") ?? "absent";', otherBranch)).content.at(-1).text, "absent");
});

test("Codemode propagates failed nested outcomes, script failures, and aborts", async (t) => {
	const f = await fixture(t);
	const ctx = nestedContext(f, true);
	const caught = await executeScript(f, 'try { await tools.probe({}); } catch { return "caught"; }', ctx);
	assert.ok(!caught.isError, textOf(caught));
	assert.equal(caught.details.calls[0].status, "error");
	assert.match(caught.details.calls[0].error, /permission denied/);
	const failed = await executeScript(f, 'store("discarded", true); throw new Error("fixture failure");', ctx);
	assert.equal(failed.isError, true);
	assert.match(textOf(failed), /fixture failure/);
	assert.deepEqual(f.entries, []);
	const aborted = await executeScript(f, 'return "should not run";', ctx, undefined, AbortSignal.abort());
	assert.equal(aborted.isError, true);
});

test("loadout/context declarations match native Codemode in both modes", async (t) => {
	const f = await fixture(t);
	const tool = f.tool("codemode");
	const native = f.native.tools.get("codemode").definition;
	const callable = nestedContext(f).tools;
	const loadout = {
		declared: [tool, ...callable], callable, registered: [tool, ...callable],
		getExposure: (name) => name === "codemode" ? "model-only" : "direct",
		getNamespace: () => undefined,
	};
	for (const mode of ["on", "only"]) {
		f.setSettings({ codemode: { mode, inlineBudget: 0 } });
		assert.deepEqual(tool.prepareLoadout(loadout), native.prepareLoadout(loadout));
		if (mode === "only") assert.ok(tool.prepareLoadout(loadout).hiddenDeclarations.includes("probe"));
	}
});

test("directory discovery loads only index.ts; built-in fallback survives extension load failure", async (t) => {
	const cwd = await mkdtemp(join(temporary, "loader-"));
	const agentDir = join(cwd, "agent");
	await mkdir(join(agentDir, "extensions"), { recursive: true });
	// Copy both files so the real loader must choose the index, not execute this test.
	const directory = join(agentDir, "extensions", "minimal-tools");
	await mkdir(directory);
	await writeFile(join(directory, "index.ts"), await readFile(extensionPath));
	await writeFile(join(directory, "test.mjs"), 'throw new Error("Tests must not run during extension discovery");');
	const options = {
		cwd, agentDir, settingsManager: pi.SettingsManager.inMemory(),
		extensionFactories: [{ name: "codemode", factory: pi.createCodemodeExtension(), replaceable: true, builtin: true }],
		noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
	};
	const loader = new pi.DefaultResourceLoader(options);
	await loader.reload();
	const loaded = loader.getExtensions();
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.flatMap((e) => [...e.tools.keys()]).filter((name) => name === "codemode").length, 1);
	assert.ok(loaded.extensions.some((e) => e.path === join(directory, "index.ts")));
	await writeFile(join(directory, "index.ts"), 'throw new Error("Fixture extension load failure");');
	await loader.reload();
	const fallback = loader.getExtensions();
	assert.ok(fallback.errors.some((error) => /Fixture extension load failure/.test(error.error)));
	assert.ok(fallback.extensions.some((e) => e.path === "builtin:codemode" && e.tools.has("codemode")));
});
