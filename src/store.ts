import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Mnemopi } from "@oh-my-pi/pi-mnemopi/core";

import { openForRead } from "./config";
import { findArchiveIds, isArchiveSource } from "./policy";
import { t } from "./i18n";
const EDIT_SOURCE = "user-memory-editor";
type Metadata = Record<string, unknown>;
interface Origin { cwd?: string; project?: string }
export interface MemoryBank { bank: string; path: string }
export interface MemoryScope {
	global: boolean;
	root: string;
	label: "Global" | "Project";
	banks: MemoryBank[];
	projectRoots?: string[];
}
interface StoredRow {
	id: string;
	store: "working" | "episodic";
	content: string;
	source: string | null;
	session_id: string | null;
	importance: number;
	metadata_json: string | null;
	valid_until: string | null;
	superseded_by: string | null;
}
export interface MemoryRow extends StoredRow { location: MemoryBank }
export interface MemoryEntry { content: string; rows: MemoryRow[] }
export class MemoryConflictError extends Error {
	constructor() { super(t("conflict")); }
}
function metadata(text: string | null): Metadata {
	if (!text) return {};
	try {
		const value: unknown = JSON.parse(text);
		return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Metadata : {};
	} catch { return {}; }
}
function active(row: StoredRow): boolean {
	const expiry = row.valid_until?.replace(" ", "T");
	return !row.superseded_by && (!expiry || Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(expiry) ? expiry : `${expiry}Z`) > Date.now());
}
function normalizedPath(path: string): string {
	return existsSync(path) ? realpathSync(path) : resolve(path);
}
function within(path: string, root: string): boolean {
	const part = relative(root, path);
	return !part || (part !== ".." && !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(part));
}
function gitProject(cwd: string, includeWorktrees = false): { root: string; roots: string[] } | undefined {
	const result = spawnSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], { encoding: "utf8" });
	if (result.status !== 0) return undefined;
	const [common, top] = result.stdout.trim().split("\n");
	if (!common || !top) return undefined;
	const root = normalizedPath(basename(common) === ".git" ? dirname(common) : top);
	if (!includeWorktrees) return { root, roots: [normalizedPath(top)] };
	const worktrees = spawnSync("git", ["-C", cwd, "worktree", "list", "--porcelain", "-z"], { encoding: "utf8" });
	const roots = worktrees.status === 0
		? worktrees.stdout.split("\0").filter(item => item.startsWith("worktree ")).map(item => normalizedPath(item.slice(9)))
		: [normalizedPath(top)];
	return { root, roots };
}
function rows(db: Database, source?: string): StoredRow[] {
	const where = source === undefined ? "" : " WHERE source = ?";
	return db.query<StoredRow, string[]>(`
		SELECT id, 'working' AS store, content, source, session_id, importance, metadata_json, valid_until, superseded_by FROM working_memory${where}
		UNION ALL
		SELECT id, 'episodic' AS store, content, source, session_id, importance, metadata_json, valid_until, superseded_by FROM episodic_memory${where}
		ORDER BY importance DESC, id
	`).all(...(source === undefined ? [] : [source, source]));
}
function archiveIds(db: Database): Set<string> {
	const lineage = db.query<{ id: string; source: string | null; summary_of: string | null; valid_until: string | null; superseded_by: string | null }, []>(`
		SELECT id, source, NULL AS summary_of, valid_until, superseded_by FROM working_memory
		UNION ALL
		SELECT id, source, summary_of, valid_until, superseded_by FROM episodic_memory
	`).all();
	return findArchiveIds(lineage);
}
function origins(bank: MemoryBank): Origin[] {
	const db = openForRead(bank.path);
	try {
		return db.query<{ cwd: unknown; project: unknown }, []>(`
			SELECT DISTINCT json_extract(metadata_json, '$.cwd') AS cwd,
			 json_extract(metadata_json, '$.memory_editor.projectRoot') AS project
			FROM (SELECT metadata_json FROM working_memory UNION ALL SELECT metadata_json FROM episodic_memory)
			WHERE json_valid(metadata_json)
		`).all().map(row => ({
			cwd: typeof row.cwd === "string" && isAbsolute(row.cwd) ? normalizedPath(row.cwd) : undefined,
			project: typeof row.project === "string" && isAbsolute(row.project) ? normalizedPath(row.project) : undefined,
		}));
	} finally { db.close(); }
}
function belongs(meta: Metadata, scope: MemoryScope, matches: Map<string, boolean>): boolean {
	if (scope.global) return true;
	const editor = meta.memory_editor;
	if (editor && typeof editor === "object" && "projectRoot" in editor && editor.projectRoot === scope.root) return true;
	if (typeof meta.cwd !== "string" || !isAbsolute(meta.cwd)) return false;
	const cwd = normalizedPath(meta.cwd);
	const previous = matches.get(cwd);
	if (previous !== undefined) return previous;
	const inside = scope.projectRoots?.some(root => within(cwd, root)) ?? false;
	const project = inside ? gitProject(cwd) : undefined;
	const match = inside && (!project || project.root === scope.root);
	matches.set(cwd, match);
	return match;
}

/** Show only the current logical project; registered Git worktrees share that identity. */
export function listScopes(globalPath: string, cwd: string): MemoryScope[] {
	// Mnemopi creates the global database lazily; until then the global scope is simply empty.
	const global: MemoryScope = { global: true, root: dirname(globalPath), label: "Global",
		banks: existsSync(globalPath) ? [{ bank: "default", path: globalPath }] : [] };
	const banksDir = join(dirname(globalPath), "banks");
	const candidates: Array<{ bank: MemoryBank; origins: Origin[] }> = [];
	if (existsSync(banksDir)) {
		for (const item of readdirSync(banksDir, { withFileTypes: true })) {
			if (!item.isDirectory()) continue;
			const bank = { bank: item.name, path: join(banksDir, item.name, "mnemopi.db") };
			if (existsSync(bank.path)) candidates.push({ bank, origins: origins(bank) });
		}
	}
	const current = normalizedPath(cwd);
	const git = gitProject(current, true);
	const ancestor = candidates.flatMap(item => item.origins.flatMap(origin => origin.cwd ? [origin.cwd] : []))
		.filter(origin => within(current, origin)).sort((a, b) => b.length - a.length)[0];
	const root = git?.root ?? ancestor ?? current;
	const scope: MemoryScope = { global: false, root, label: "Project", projectRoots: git?.roots ?? [root], banks: [] };
	const matches = new Map<string, boolean>();
	for (const candidate of candidates) {
		if (candidate.origins.some(origin => {
			if (origin.project === root) return true;
			if (!origin.cwd) return false;
			return belongs({ cwd: origin.cwd }, scope, matches);
		})) scope.banks.push(candidate.bank);
	}
	return [global, scope];
}
export function listEntries(scope: MemoryScope, source?: string): MemoryEntry[] {
	const grouped = new Map<string, MemoryEntry>();
	const matches = new Map<string, boolean>();
	for (const bank of scope.banks) {
		const db = openForRead(bank.path);
		try {
			const snapshot = db.transaction(() => ({ archived: archiveIds(db), entries: rows(db, source) }))();
			for (const row of snapshot.entries) {
				if (snapshot.archived.has(row.id) || isArchiveSource(row.source) || !active(row) || !belongs(metadata(row.metadata_json), scope, matches)) continue;
				const prefix = `[${row.source}] `;
				const content = (row.source && row.content.startsWith(prefix) ? row.content.slice(prefix.length) : row.content)
					.replace(/^\[coding-agent-retain\]\s*/, "").trim();
				if (!content) continue;
				const source = { ...row, location: bank };
				// One entry lives in one bank; identical text elsewhere is a separate entry to merge explicitly.
				const key = `${bank.path}\n${content}`;
				const prior = grouped.get(key);
				if (prior) prior.rows.push(source);
				else grouped.set(key, { content, rows: [source] });
			}
		} finally { db.close(); }
	}
	return [...grouped.values()];
}

/** Retired working memories are negative admission evidence, never active guidance. */
export function retiredGuidance(scopes: MemoryScope[]): string[] {
	const retired = new Set<string>();
	for (const scope of scopes) {
		const matches = new Map<string, boolean>();
		for (const bank of scope.banks) {
			const db = openForRead(bank.path);
			try {
				for (const row of rows(db)) {
					if (row.store !== "working" || !row.valid_until || row.superseded_by || active(row) ||
						isArchiveSource(row.source) || !belongs(metadata(row.metadata_json), scope, matches)) continue;
					retired.add(row.content.replace(/^\[coding-agent-retain\]\s*/, "").trim());
				}
			} finally { db.close(); }
		}
	}
	return [...retired];
}

/** Memories available here: shared preferences, then this project's entries. */
export function listProjectEntries(globalPath: string, cwd: string): Array<{ scope: MemoryScope; entry: MemoryEntry }> {
	return listScopes(globalPath, cwd).flatMap(scope => listEntries(scope).map(entry => ({ scope, entry })));
}

function changeEntry(scope: MemoryScope, entry: MemoryEntry, content: string | undefined): string | undefined {
	const bank = entry.rows[0].location;
	const db = new Database(bank.path, { strict: true });
	const owners = new Map<string, Mnemopi>();
	const owner = (sessionId: string): Mnemopi => {
		let memory = owners.get(sessionId);
		if (!memory) {
			memory = new Mnemopi({ db, dbPath: bank.path, bank: bank.bank, sessionId, channelId: bank.bank,
				llm: false, embeddings: false, reconcile: false });
			owners.set(sessionId, memory);
		}
		return memory;
	};
	try {
		db.exec("BEGIN IMMEDIATE");
		for (const row of entry.rows) {
			const table = row.store === "working" ? "working_memory" : "episodic_memory";
			const current = db.query<StoredRow, [string]>(`SELECT * FROM ${table} WHERE id=?`).get(row.id);
			if (!current || !active(current) || current.content !== row.content) throw new MemoryConflictError();
		}
		let replacement: string | undefined;
		if (content !== undefined) {
			const source = entry.rows[0];
			// OMP's memory_edit only updates or forgets rows whose session id is the bank name.
			replacement = owner(bank.bank).remember(content, {
				source: EDIT_SOURCE, importance: Math.max(...entry.rows.map(row => row.importance)), scope: "bank",
				extract: false, extractEntities: false, veracity: "stated",
				metadata: { ...metadata(source.metadata_json),
					memory_editor: { edited_at: Date.now(), projectRoot: scope.global ? null : scope.root, supersedes: entry.rows.map(row => row.id) } },
			});
		}
		for (const row of entry.rows) {
			if (!owner(row.session_id ?? bank.bank).beam.invalidate(row.id, replacement ?? null)) throw new MemoryConflictError();
		}
		db.exec("COMMIT");
		return replacement;
	} catch (error) {
		if (db.inTransaction) db.exec("ROLLBACK");
		throw error;
	} finally {
		for (const memory of owners.values()) memory.close();
		db.close();
	}
}
export function saveEntry(scope: MemoryScope, entry: MemoryEntry, content: string): string {
	if (!content.trim()) throw new Error(t("emptySave"));
	if (content === entry.content) return entry.rows[0].id;
	return changeEntry(scope, entry, content)!;
}
export function deleteEntry(scope: MemoryScope, entry: MemoryEntry): void {
	changeEntry(scope, entry, undefined);
}
/**
 * Move an entry to another scope (global, or a project from listScopes(globalPath, projectCwd)[1]). The copy is
 * written first, so a failure afterwards leaves a duplicate rather than losing the memory.
 */
export function moveEntry(from: MemoryScope, entry: MemoryEntry, to: MemoryScope): string {
	const bank = to.banks[0];
	if (!bank) throw new Error(t("noTargetBank", { root: to.root }));
	const source = entry.rows[0];
	// OMP's memory_edit only updates or forgets rows whose session id is the bank name.
	const memory = new Mnemopi({ dbPath: bank.path, bank: bank.bank, sessionId: bank.bank, channelId: bank.bank,
		llm: false, embeddings: false, reconcile: false });
	let id: string;
	try {
		id = memory.remember(entry.content, {
			source: source.source ?? EDIT_SOURCE, importance: Math.max(...entry.rows.map(row => row.importance)), scope: "bank",
			extract: false, extractEntities: false, veracity: "stated",
			metadata: { ...metadata(source.metadata_json), ...(to.global ? {} : { cwd: to.root }),
				memory_editor: { edited_at: Date.now(), projectRoot: to.global ? null : to.root, supersedes: entry.rows.map(row => row.id) } },
		});
	} finally { memory.close(); }
	deleteEntry(from, entry);
	return id;
}

/** Edited project rules remain current across sessions and worktrees; unrelated projects stay isolated. */
export function liveProjectEdits(globalPath: string, cwd: string): Array<{ id: string; content: string }> {
	const scope = listScopes(globalPath, cwd)[1];
	return listEntries(scope, EDIT_SOURCE).map(entry => ({ id: entry.rows[0].id, content: entry.content }));
}
