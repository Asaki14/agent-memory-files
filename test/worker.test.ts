import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dispatch } from "../src/worker-process";
import type { WorkerPayload } from "../src/queue";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): WorkerPayload {
	const root = mkdtempSync(join(tmpdir(), "memory-worker-"));
	roots.push(root);
	const scope = { global: false, root, path: join(root, "AGENTS.memory.md") };
	return { job: { global: { ...scope, global: true }, project: scope, cwd: root,
		sessionId: "session", sourceEntry: "entry", conversation: [{ role: "user", content: "记忆".repeat(524288) }] },
		attempts: 0, queueDir: join(root, "queue") };
}
function resultFrom(path: string): Promise<{ payload: WorkerPayload; mode: number; event: string }> {
	const { promise, resolve, reject } = Promise.withResolvers<{ payload: WorkerPayload; mode: number; event: string }>();
	const watcher = watch(dirname(path), () => {
		const text = existsSync(path) ? readFileSync(path, "utf8") : "";
		if (!text.endsWith("\n")) return;
		watcher.close();
		try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
	});
	watcher.on("error", error => { watcher.close(); reject(error); });
	return promise;
}

test("A detached worker receives the complete conversation after its host exits immediately", async () => {
	const payload = fixture();
	const log = join(payload.job.cwd, "worker.log");
	const completed = resultFrom(log);
	const worker = `
		import { readFileSync, statSync, writeSync } from "node:fs";
		import { release } from ${JSON.stringify(join(import.meta.dir, "../src/queue.ts"))};
		const payload = JSON.parse(readFileSync(3, "utf8"));
		const mode = statSync(payload.claimed).mode & 0o777;
		release(payload.claimed);
		writeSync(2, JSON.stringify({ payload, mode }) + "\\n");
	`;
	const parent = `
		import { dispatch } from ${JSON.stringify(join(import.meta.dir, "../src/worker-process.ts"))};
		const root = ${JSON.stringify(payload.job.cwd)};
		const scope = { global: false, root, path: root + "/AGENTS.memory.md" };
		dispatch(root, { job: { global: { ...scope, global: true }, project: scope, cwd: root,
			sessionId: "session", sourceEntry: "entry", conversation: [{ role: "user", content: "记忆".repeat(524288) }] },
			attempts: 0, queueDir: root + "/queue" }, ${JSON.stringify(log)}, ["-e", ${JSON.stringify(worker)}]);
		process.exit(0);
	`;
	const parentResult = spawnSync(process.execPath, ["-e", parent], { env: { ...process.env, BUN_BE_BUN: "1" }, encoding: "utf8" });
	expect(parentResult.status, parentResult.stderr).toBe(0);
	const result = await completed;
	expect(result.payload.job).toEqual(payload.job);
	expect(result.payload.attempts).toBe(0);
	expect(result.mode).toBe(0o600);
	expect(existsSync(result.payload.claimed!)).toBe(false);
});

test("A failed worker launch retains the conversation for retry", async () => {
	const payload = fixture();
	const log = join(payload.job.cwd, "worker.log");
	const completed = resultFrom(log);
	dispatch(join(payload.job.cwd, "missing"), payload, log, ["-e", "process.exit(0)"]);
	const result = await completed;
	expect(result.event).toBe("memory_session_requeued");
	const queued = JSON.parse(readFileSync(join(payload.queueDir, "session-entry.json"), "utf8"));
	expect(queued.job).toEqual(payload.job);
	expect(queued.attempts).toBe(1);
});
test("Memory completion walks the configured models and only fails after exhausting them", () => {
	// Keep provider mocks in a subprocess so other test files see the real modules.
	const script = `
		import { mock } from "bun:test";
		import assert from "node:assert/strict";
		let scenario = "quota";
		let calls = [];
		const candidates = [
			{ model: { provider: "ollama", id: "local", api: "local-inference" } },
			{ model: { provider: "openai-codex", id: "primary", api: "test" } },
			{ model: { provider: "anthropic", id: "backup", api: "test" } }
		];
		mock.module("@oh-my-pi/pi-ai", () => ({ completeSimple: async model => {
			calls.push(model.id);
			if (model.id === "primary") {
				if (scenario === "throw") throw new Error("connection reset");
				if (scenario === "empty") return { stopReason: "stop", content: [] };
				return { stopReason: "error", errorMessage: "You have hit your ChatGPT usage limit", content: [] };
			}
			if (scenario === "all") throw new Error("backup unavailable");
			return { stopReason: "stop", content: [{ type: "text", text: '{"memories":[]}' }] };
		} }));
		mock.module("@oh-my-pi/pi-catalog/model-thinking", () => ({ clampThinkingLevelForModel: (_model, level) => level }));
		mock.module("@oh-my-pi/pi-tui/thinking", () => ({ concreteThinkingLevel: () => "off", shouldDisableReasoning: () => true, toReasoningEffort: () => undefined }));
		mock.module("@oh-my-pi/pi-coding-agent", () => ({ Settings: { instance: {} } }));
		mock.module("@oh-my-pi/pi-coding-agent/config/model-roles", () => ({ roleCandidatePool: () => [] }));
		mock.module("@oh-my-pi/pi-coding-agent/config/model-resolver", () => ({ resolveRoleChain: () => candidates }));
		// Static imports run before mock.module installs the isolated provider implementations.
		const { completeMemory } = await import(${JSON.stringify(join(import.meta.dir, "../src/worker.ts"))});
		const ctx = { sessionManager: { getSessionId: () => "session" }, modelRegistry: { getApiKey: async () => "key", resolver: () => "key" } };
		for (scenario of ["quota", "throw", "empty"]) {
			calls = [];
			assert.equal(await completeMemory(ctx, "system", "input"), '{"memories":[]}');
			assert.deepEqual(calls, ["primary", "backup"]);
		}
		scenario = "all";
		calls = [];
		await assert.rejects(() => completeMemory(ctx, "system", "input"), error =>
			error.message.includes("openai-codex/primary: error: You have hit your ChatGPT usage limit") &&
			error.message.includes("anthropic/backup: backup unavailable"));
		assert.deepEqual(calls, ["primary", "backup"]);
		console.log("memory fallback regression passed");
	`;
	const result = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, BUN_BE_BUN: "1" }, encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout.trim()).toBe("memory fallback regression passed");
});
