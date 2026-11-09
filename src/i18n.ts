import { readFileSync } from "node:fs";
import { join } from "node:path";

/** UI text only. Model-facing prompts and log events stay English so behavior does not vary by locale. */
const en = {
	editTitle: "Edit {path} (one memory per \"- \" line)",
	saved: "Saved; applies from the next session",
	overLimit: "Saved, but over the limit: {entries}/{maxEntries} entries, {chars}/{maxChars} characters. Trim it or run /memories review.",
	conflict: "The file changed while you were editing; nothing was overwritten. Reopen it.",
	needsUI: "Open this in an interactive OMP session.",
	memories: "Memories",
	globalLabel: "Global · {entries}/{limit}",
	projectLabel: "Project · {entries}/{limit}",
	commandDescription: "Edit global and project memory files; /memories review starts a review with the current model",
	status: "{count} memories",
	extractionFailed: "Automatic memory extraction failed: {error}",
	reviewDescription: "Review and organize global and current-project memories with the current model",
	commandUsage: "Usage: /memories or /memories review",
	noReviewMemories: "No memories to review yet.",
};
type Key = keyof typeof en;

const zhCN: Record<Key, string> = {
	editTitle: "编辑 {path}（每行 \"- \" 开头为一条记忆）",
	saved: "已保存，下次会话生效",
	overLimit: "已保存，但超出上限：{entries}/{maxEntries} 条，{chars}/{maxChars} 字。请精简，或运行 /memories review。",
	conflict: "编辑期间文件已被修改，本次未覆盖。请重新打开。",
	needsUI: "请在 OMP 交互窗口中打开。",
	memories: "记忆",
	globalLabel: "全局 · {entries}/{limit}",
	projectLabel: "项目 · {entries}/{limit}",
	commandDescription: "编辑全局和项目记忆文件；/memories review 使用当前模型审查整理",
	status: "记忆{count}条",
	extractionFailed: "自动记忆提炼失败：{error}",
	reviewDescription: "使用当前模型审查整理全局和当前项目记忆",
	commandUsage: "用法：/memories 或 /memories review",
	noReviewMemories: "暂无可审查的记忆。",
};

const catalogs: Record<string, Record<Key, string>> = { en, "zh-CN": zhCN };
let active: Record<Key, string> = en;

/**
 * Pick the UI language: `locale` in `<agentDir>/agent-memory-files.json`, else the POSIX locale
 * (`LC_ALL`, `LC_MESSAGES`, `LANG`). Chinese locales map to `zh-CN`; anything else is English.
 * Until this runs (e.g. in tests) text is English.
 */
export function initLocale(agentDir: string): void {
	let configured: unknown;
	try {
		const config: unknown = JSON.parse(readFileSync(join(agentDir, "agent-memory-files.json"), "utf8"));
		if (config && typeof config === "object" && "locale" in config) configured = config.locale;
	} catch {
		// No config file: fall back to the environment.
	}
	const requested = typeof configured === "string" ? configured
		: process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
	active = /^zh/i.test(requested) ? catalogs["zh-CN"]! : catalogs[requested] ?? en;
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
	return active[key].replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match);
}
