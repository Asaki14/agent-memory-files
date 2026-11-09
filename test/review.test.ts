import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Mnemopi } from "@oh-my-pi/pi-mnemopi/core";
import { reviewPrompt } from "../src/review";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function bank(path: string, name: string) {
	mkdirSync(dirname(path), { recursive: true });
	const memory = new Mnemopi({ dbPath: path, bank: name, channelId: name, sessionId: "review-fixture",
		llm: false, embeddings: false, reconcile: false });
	cleanups.push(() => memory.close());
	return memory;
}

test("Manual review includes current scopes and retirement feedback without leaking credentials or unrelated projects", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-review-test-")));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	const cwd = join(root, "current-project");
	mkdirSync(cwd);
	const globalPath = join(root, "memories", "mnemopi.db");
	const global = bank(globalPath, "default");
	const current = bank(join(dirname(globalPath), "banks", "current", "mnemopi.db"), "current");
	const unrelated = bank(join(dirname(globalPath), "banks", "unrelated", "mnemopi.db"), "unrelated");
	const remember = (memory: Mnemopi, content: string, origin?: string) => memory.remember(content, {
		scope: "bank", extract: false, extractEntities: false, metadata: origin ? { cwd: origin } : {},
	});
	remember(global, "The user prefers concise answers.");
	remember(global, "Service password=hunter2");
	remember(current, "Current project's external account requires manual renewal.", cwd);
	remember(unrelated, "Unrelated project's private constraint.", join(root, "other-project"));
	const retired = remember(global, "Retired global preference.");
	const secretRetired = remember(global, "Retired secret=private-value");
	for (const id of [retired, secretRetired]) global.beam.invalidate(id, null);
	const prompt = reviewPrompt(globalPath, cwd)!;
	const snapshot = JSON.parse(prompt.split("\n\n").at(-1)!);
	expect(snapshot.entries.map((entry: { scope: string }) => entry.scope).sort()).toEqual(["global", "project"]);
	expect(snapshot.retired_memories).toEqual(["Retired global preference."]);
	expect(prompt).not.toContain("hunter2");
	expect(prompt).not.toContain("private-value");
	expect(prompt).not.toContain("Unrelated project's private constraint.");
});

test("An empty bank or credential-only bank cannot start a review", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-review-empty-")));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, "mnemopi.db");
	expect(reviewPrompt(path, root)).toBeUndefined();
	const memory = bank(path, "default");
	memory.remember("password=hunter2", { scope: "bank", extract: false, extractEntities: false });
	expect(reviewPrompt(path, root)).toBeUndefined();
});
