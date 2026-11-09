import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { hasSecret } from "./policy";

/** Name of the memory file in the agent directory (global) and in each project root (project). */
export const MEMORY_FILE = "AGENTS.memory.md";
/** Global memory is injected into every conversation, so it gets the tighter budget. */
export const LIMITS = { global: { entries: 20, chars: 4000 }, project: { entries: 30, chars: 6000 } } as const;

export interface MemoryScope { global: boolean; root: string; path: string }
export interface Usage { entries: number; chars: number }

/** A Git checkout and its worktrees share the main checkout's root; outside Git the directory itself is the project. */
export function projectRoot(cwd: string): string {
	const path = existsSync(cwd) ? realpathSync(cwd) : resolve(cwd);
	const git = spawnSync("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], { encoding: "utf8" });
	if (git.status !== 0) return path;
	const [common, top] = git.stdout.trim().split("\n");
	if (!common || !top) return path;
	return realpathSync(basename(common) === ".git" ? dirname(common) : top);
}

export function memoryScopes(agentDir: string, cwd: string): [MemoryScope, MemoryScope] {
	const root = projectRoot(cwd);
	return [{ global: true, root: agentDir, path: join(agentDir, MEMORY_FILE) },
		{ global: false, root, path: join(root, MEMORY_FILE) }];
}

export function limitsOf(scope: MemoryScope) {
	return scope.global ? LIMITS.global : LIMITS.project;
}

export function readMemory(path: string): string {
	try { return readFileSync(path, "utf8"); } catch { return ""; }
}

/** Every top-level "- " line is one memory; headings and comments are free-form. */
export function entriesOf(text: string): string[] {
	return text.split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2).trim()).filter(Boolean);
}

export function usageOf(text: string): Usage {
	const entries = entriesOf(text);
	return { entries: entries.length, chars: entries.reduce((sum, entry) => sum + entry.length, 0) };
}

function header(scope: MemoryScope): string {
	const limit = limitsOf(scope);
	return `# ${scope.global ? "Global" : "Project"} memory\n\n` +
		`<!-- One memory per "- " line. Limit: ${limit.entries} entries, ${limit.chars} characters. -->\n\n`;
}

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

/** Serialize writers across sessions and the extraction worker; a lock older than 30 s belongs to a dead process. */
function withLock<T>(path: string, action: () => T): T {
	const lock = `${path}.lock`;
	mkdirSync(dirname(path), { recursive: true });
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try { mkdirSync(lock); break; } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmdirSync(lock); continue; } } catch { continue; }
			if (Date.now() > deadline) throw new Error(`Memory file is locked: ${lock}`);
			Bun.sleepSync(50);
		}
	}
	try { return action(); } finally { rmdirSync(lock); }
}

function writeAtomic(path: string, text: string): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, text);
	renameSync(temporary, path);
}

export class MemoryConflictError extends Error {
	constructor() { super("The memory file changed since it was opened."); }
}

/** Replace the whole file (manual editing). Refuses if another writer changed it after `expected` was read. */
export function writeMemory(scope: MemoryScope, expected: string, text: string): void {
	withLock(scope.path, () => {
		if (readMemory(scope.path) !== expected) throw new MemoryConflictError();
		writeAtomic(scope.path, text.endsWith("\n") || !text ? text : `${text}\n`);
	});
}

/**
 * Append new memories, dated, while the scope stays within its limits. Existing text is kept verbatim.
 * Returns the memories that did not fit.
 */
export function appendMemories(scope: MemoryScope, contents: string[], date = new Date().toISOString().slice(0, 10)): string[] {
	if (!contents.length) return [];
	return withLock(scope.path, () => {
		const current = readMemory(scope.path);
		const known = new Set(entriesOf(current).map(entry => entry.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, "")));
		const limit = limitsOf(scope);
		const usage = usageOf(current);
		const added: string[] = [];
		const rejected: string[] = [];
		for (const content of contents) {
			if (known.has(content)) continue;
			const line = `[${date}] ${content}`;
			if (usage.entries + 1 > limit.entries || usage.chars + line.length > limit.chars) { rejected.push(content); continue; }
			usage.entries++;
			usage.chars += line.length;
			known.add(content);
			added.push(`- ${line}`);
		}
		if (added.length) {
			const base = current || header(scope);
			writeAtomic(scope.path, `${base}${base.endsWith("\n") ? "" : "\n"}${added.join("\n")}\n`);
		}
		return rejected;
	});
}
/** Both memory files plus the rules for changing them, read once per session so edits apply from the next one. */
export function memoryContext(agentDir: string, cwd: string): string {
	const [global, project] = memoryScopes(agentDir, cwd);
	const describe = (scope: MemoryScope, bar: string) => {
		const limit = limitsOf(scope);
		return `- ${scope.global ? "Global" : "Project"}: ${scope.path} (limit ${limit.entries} entries, ${limit.chars} characters). ${bar}`;
	};
	const block = (tag: string, scope: MemoryScope) => {
		// Credential-bearing lines stay on disk but never reach the model.
		const text = readMemory(scope.path).split("\n").filter(line => !hasSecret(line)).join("\n").trim();
		return text ? [`<${tag} path="${scope.path}">`, text, `</${tag}>`] : [];
	};
	return [
		"Long-term memory lives in two Markdown files that are loaded in full at session start; changes apply from the next session.",
		describe(global, "Strictest bar: only standing user-wide contracts or stable personal facts that stay correct in any conversation. Project, app, repository, and workflow rules never go here."),
		describe(project, "Strict bar: only durable decisions, constraints, or preferences for this project that later sessions need and cannot read from the repository, its docs, configuration, or Git history."),
		"Each memory is one \"- [YYYY-MM-DD] text\" line. Use your file tools to add, edit, merge, or delete memories when the user asks or the conversation clearly settles a durable fact. Save only user-evidenced, action-changing facts; never work reports, plans, trials, configuration snapshots, or secrets. Keep each file within its limit: before adding to a full file, merge or drop weaker entries. A memory that belongs to another project goes into that project's root AGENTS.memory.md (the main checkout for Git worktrees). Routine facts are extracted automatically when the session ends; do not save them yourself.",
		...block("global_memory", global),
		...block("project_memory", project),
	].join("\n");
}

