import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationFromMessages, guidanceInput, parseGuidance, type GuidanceConversation, type MemoryState } from "../src/guidance";
import { claimQueued, enqueue, type GuidanceJob } from "../src/queue";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const empty: MemoryState = { global: [], project: [], globalRoom: 20, projectRoom: 30 };

test("Accepts only memories with verbatim source evidence and stores neither evidence nor raw dialogue", () => {
	const exchange: GuidanceConversation = [
		{ role: "user", content: "Please remember: answer in English and give me only the conclusions I need." },
		{ role: "assistant", content: "I'll follow that preference." },
	];
	expect(guidanceInput(exchange, { ...empty, project: ["Existing project memory"] })).toBeDefined();
	const parsed = parseGuidance(JSON.stringify({ memories: [{
		kind: "preference", scope: "global", content: "The user prefers English responses and concise conclusions.", from: "user", evidence: "answer in English",
	}] }), exchange);
	expect(parsed).toEqual([{ kind: "preference", scope: "global", content: "The user prefers English responses and concise conclusions." }]);
	expect(JSON.stringify(parsed)).not.toContain("answer in English");
	expect(parseGuidance(JSON.stringify({ memories: [{ kind: "decision", scope: "project", content: exchange[0].content, from: "user", evidence: exchange[0].content }] }), exchange)).toEqual([]);
});

test("Rejects assistant-inferred preferences, fabricated evidence, and global project facts while dropping only invalid candidates", () => {
	const exchange: GuidanceConversation = [
		{ role: "user", content: "How do I set the theme? Use light mode consistently from now on." }, { role: "assistant", content: "The user may prefer a dark theme." },
	];
	const rejected: string[] = [];
	expect(parseGuidance(JSON.stringify({ memories: [
		{ kind: "preference", scope: "global", content: "The user prefers a dark theme.", from: "assistant", evidence: "The user may prefer a dark theme." },
		{ kind: "project_fact", scope: "project", content: "The project uses a dark theme.", from: "user", evidence: "The project has confirmed it uses a dark theme." },
		{ kind: "project_fact", scope: "global", content: "The theme setting lives in settings.", from: "user", evidence: "How do I set the theme?" },
		{ kind: "preference", scope: "project", content: "The user wants a consistent light theme.", from: "user", evidence: "Use light mode consistently from now on" },
	] }), exchange, reason => rejected.push(reason))).toEqual([{ kind: "preference", scope: "project", content: "The user wants a consistent light theme." }]);
	expect(rejected).toEqual(["Preferences and decisions must be confirmed by the user.", "Evidence does not appear in this session.",
		"Project facts cannot be global memories."]);
	expect(() => parseGuidance(JSON.stringify({ items: [] }), exchange)).toThrow("Memory extraction result has an invalid format.");
});

test("Excludes credential-bearing input while allowing ordinary token-counting requests", () => {
	const credential: GuidanceConversation = [
		{ role: "user", content: "Please remember password=hunter2" }, { role: "assistant", content: "Recorded." },
	];
	expect(guidanceInput(credential, empty)).toBeUndefined();
	const ordinary: GuidanceConversation = [
		{ role: "user", content: "Count the tokens in this text." }, { role: "assistant", content: "I can count the token total." },
	];
	expect(guidanceInput(ordinary, empty)).toBeDefined();
});

test("Preserves correction order, verifies earlier evidence, and excludes sensitive messages", () => {
	const conversation: GuidanceConversation = [
		{ role: "user", content: "Atlas retains backups for 7 days." },
		{ role: "assistant", content: "Understood." },
		{ role: "user", content: "password=hunter2" },
		{ role: "user", content: "Correction: Atlas retains backups for 30 days; the earlier 7-day period is obsolete." },
		{ role: "assistant", content: "Atlas uses a 30-day retention policy." },
	];
	const input = JSON.parse(guidanceInput(conversation, { ...empty, globalRoom: 0 })!);
	expect(input.messages.map((message: { content: string }) => message.content)).toEqual([
		"Atlas retains backups for 7 days.", "Understood.",
		"Correction: Atlas retains backups for 30 days; the earlier 7-day period is obsolete.", "Atlas uses a 30-day retention policy.",
	]);
	expect(input.global_room).toBe(0);
	expect(parseGuidance(JSON.stringify({ memories: [
		{ kind: "decision", scope: "project", content: "Atlas's backup retention period is confirmed as 30 days.", from: "user", evidence: "Atlas retains backups for 30 days" },
	] }), conversation)).toEqual([{ kind: "decision", scope: "project", content: "Atlas's backup retention period is confirmed as 30 days." }]);
	expect(parseGuidance(JSON.stringify({ memories: [
		{ kind: "project_fact", scope: "project", content: "Atlas enables account verification.", from: "user", evidence: "password=hunter2" },
	] }), conversation)).toEqual([]);
});

test("Ask confirmations retain their question source; ordinary tools, failures, and uncorrelated results cannot impersonate user decisions", () => {
	const question = "What is Atlas's backup retention period?";
	const call = { role: "assistant", stopReason: "toolUse", content: [{
		type: "toolCall", name: "ask", id: "choose-retention",
		arguments: { questions: [{ question, options: [{ label: "7 days" }, { label: "30 days" }] }] },
	}] };
	const result = { role: "toolResult", toolName: "ask", toolCallId: "choose-retention", isError: false,
		content: [{ type: "text", text: "User selected: 30 days" }],
		details: { question, selectedOptions: ["30 days"] } };
	const conversation = conversationFromMessages([
		{ role: "user", content: "Choose the project's backup retention period using the selection control." }, call,
		{ ...result, toolName: "bash" }, { ...result, isError: true },
		{ ...result, toolCallId: "unrelated" }, result,
		{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Configuration completed based on the selection." }] },
	]);
	expect(conversation).toEqual([
		{ role: "user", content: "Choose the project's backup retention period using the selection control." },
		{ role: "user", content: '{"selectedOptions":["30 days"]}', source: {
			kind: "ask", toolCallId: "choose-retention", question, options: [{ label: "7 days" }, { label: "30 days" }],
		} },
		{ role: "assistant", content: "Configuration completed based on the selection." },
	]);
	expect(parseGuidance(JSON.stringify({ memories: [{
		kind: "decision", scope: "project", content: "Atlas's backup retention period is confirmed as 30 days.", from: "user", evidence: "30 days",
	}] }), conversation)).toEqual([{ kind: "decision", scope: "project", content: "Atlas's backup retention period is confirmed as 30 days." }]);
	expect(parseGuidance(JSON.stringify({ memories: [{
		kind: "decision", scope: "project", content: "Atlas's backup retention period is confirmed as 7 days.", from: "user", evidence: "7 days",
	}] }), conversation)).toEqual([]);
});

test("Queues failed jobs for one session at a time and reclaims them after a claimant times out", () => {
	const root = mkdtempSync(join(tmpdir(), "guidance-queue-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	const scope = { global: false, root: "/tmp", path: "/tmp/AGENTS.memory.md" };
	const job: GuidanceJob = { global: { ...scope, global: true }, project: scope, cwd: "/tmp", sessionId: "s/1", sourceEntry: "e1",
		conversation: [{ role: "user", content: "hi" }] };
	enqueue(root, job, 1);
	const first = claimQueued(root);
	expect(first).toHaveLength(1);
	expect(claimQueued(root)).toEqual([]);
	const old = (Date.now() - 31 * 60_000) / 1000;
	utimesSync(first[0]!, old, old);
	const reclaimed = claimQueued(root);
	expect(reclaimed).toHaveLength(1);
	expect(existsSync(first[0]!)).toBe(false);
	expect(readdirSync(root)).toHaveLength(1);
});

test("A date mention cannot become a stand-alone memory", () => {
	const exchange: GuidanceConversation = [
		{ role: "user", content: "The migration completed on 2026-11-09." },
		{ role: "assistant", content: "The migration is complete." },
	];
	expect(parseGuidance(JSON.stringify({ memories: [{
		kind: "project_fact", scope: "project", content: "2026-11-09", from: "user", evidence: "2026-11-09",
	}] }), exchange)).toEqual([]);
});
