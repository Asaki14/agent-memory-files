import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendMemories, entriesOf, LIMITS, MEMORY_FILE, memoryScopes, MemoryConflictError, readMemory, writeMemory } from "../src/memory-file";
import { reviewPrompt } from "../src/review";
import { memoryContext } from "../src/memory-file";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function root(): string {
	const path = realpathSync(mkdtempSync(join(tmpdir(), "file-memory-test-")));
	cleanups.push(() => rmSync(path, { recursive: true, force: true }));
	return path;
}

test("Appending keeps user text verbatim, dates new lines, skips duplicates, and stops at the entry limit", () => {
	const base = root();
	const [global] = memoryScopes(join(base, "agent"), base);
	mkdirSync(global.root, { recursive: true });
	writeFileSync(global.path, "# My notes\n\nFree text the user wrote.\n- [2026-01-01] Existing rule\n");
	const filler = Array.from({ length: LIMITS.global.entries - 1 }, (_, index) => `Rule ${index}`);
	const rejected = appendMemories(global, ["Existing rule", "New rule", ...filler], "2026-11-10");
	expect(rejected).toEqual([filler.at(-1)!]);
	const text = readFileSync(global.path, "utf8");
	expect(text.startsWith("# My notes\n\nFree text the user wrote.\n- [2026-01-01] Existing rule\n- [2026-11-10] New rule\n")).toBe(true);
	expect(entriesOf(text)).toHaveLength(LIMITS.global.entries);
	expect(appendMemories(global, ["One more"])).toEqual(["One more"]);
});

test("The character budget also limits appends, and a new file starts with its header", () => {
	const base = root();
	const [, project] = memoryScopes(join(base, "agent"), base);
	const long = "x".repeat(250);
	const rejected = appendMemories(project, Array.from({ length: 30 }, (_, index) => `${index} ${long}`), "2026-11-10");
	expect(rejected.length).toBeGreaterThan(0);
	const text = readMemory(project.path);
	expect(text.startsWith("# Project memory")).toBe(true);
	expect(entriesOf(text).reduce((sum, entry) => sum + entry.length, 0)).toBeLessThanOrEqual(LIMITS.project.chars);
});

test("Manual saves refuse to overwrite a concurrent change, and a stale lock from a dead writer is reclaimed", () => {
	const base = root();
	const [, project] = memoryScopes(join(base, "agent"), base);
	appendMemories(project, ["First"]);
	const opened = readMemory(project.path);
	appendMemories(project, ["Written by the worker meanwhile"]);
	expect(() => writeMemory(project, opened, `${opened}- Manual\n`)).toThrow(MemoryConflictError);
	expect(entriesOf(readMemory(project.path)).map(entry => entry.replace(/^\[[\d-]+\] /, ""))).toEqual(["First", "Written by the worker meanwhile"]);
	const lock = `${project.path}.lock`;
	mkdirSync(lock);
	const old = (Date.now() - 60_000) / 1000;
	utimesSync(lock, old, old);
	const current = readMemory(project.path);
	writeMemory(project, current, `${current}- Manual`);
	expect(readMemory(project.path).endsWith("- Manual\n")).toBe(true);
});

test("Git worktrees share the main checkout's project file", () => {
	const base = root();
	const main = join(base, "app");
	mkdirSync(main);
	const git = (args: string[]) => {
		const result = spawnSync("git", args, { cwd: main, encoding: "utf8" });
		if (result.status !== 0) throw new Error(result.stderr);
	};
	git(["init", "-q", "--initial-branch=main"]);
	git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "--allow-empty", "-m", "fixture"]);
	git(["worktree", "add", "-q", "-b", "tree", join(base, "tree")]);
	mkdirSync(join(base, "tree", "src"));
	expect(memoryScopes(join(base, "agent"), join(base, "tree", "src"))[1].path).toBe(join(main, MEMORY_FILE));
});

test("Session context and review include both files but never credential lines or unrelated projects", () => {
	const base = root();
	const agent = join(base, "agent");
	const project = join(base, "project");
	mkdirSync(project);
	const [global, current] = memoryScopes(agent, project);
	appendMemories(global, ["The user prefers concise answers."]);
	appendMemories(current, ["Releases need manual approval.", "Service password=hunter2"]);
	appendMemories(memoryScopes(agent, join(base, "other"))[1], ["Unrelated private constraint."]);
	const context = memoryContext(agent, project);
	expect(context).toContain("The user prefers concise answers.");
	expect(context).toContain("Releases need manual approval.");
	expect(context).not.toContain("Unrelated private constraint.");
	const prompt = reviewPrompt(agent, project)!;
	expect(prompt).toContain("Releases need manual approval.");
	expect(prompt).not.toContain("hunter2");
	expect(prompt).not.toContain("Unrelated private constraint.");
	expect(reviewPrompt(join(base, "empty-agent"), join(base, "empty"))).toBeUndefined();
});
