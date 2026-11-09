import { Settings, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { t } from "./i18n";
import { changeEntry, entriesOf, limitsOf, memoryScopes, MemoryConflictError, readMemory, splitDate, usageOf, type MemoryScope } from "./memory-file";
import { reviewPrompt } from "./review";

function refreshStatus(ctx: ExtensionContext): void {
	const count = memoryScopes(Settings.instance.getAgentDir(), ctx.cwd)
		.reduce((sum, scope) => sum + usageOf(readMemory(scope.path)).entries, 0);
	ctx.ui.setStatus("global-memory", t("status", { count }));
}

/** Edit one memory; clearing the text deletes it after confirmation. */
async function editEntry(scope: MemoryScope, entry: string, ctx: ExtensionCommandContext): Promise<void> {
	const { text } = splitDate(entry);
	let draft = text;
	for (;;) {
		const result = await ctx.ui.editor(t("editTitle"), draft);
		if (result === undefined || result.trim() === text) return;
		draft = result;
		const remove = !draft.trim();
		if (remove && !await ctx.ui.confirm(t("deleteTitle"), `${text.slice(0, 160)}\n\n${t("deleteBody")}`)) { draft = text; continue; }
		try {
			changeEntry(scope, entry, remove ? undefined : draft);
		} catch (error) {
			ctx.ui.notify(error instanceof MemoryConflictError ? t("conflict") : String(error), "error");
			return;
		}
		refreshStatus(ctx);
		ctx.ui.notify(t(remove ? "deleted" : "saved"), "info");
		return;
	}
}

async function openMemories(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) { ctx.ui.notify(t("needsUI"), "error"); return; }
	await ctx.waitForIdle();
	for (;;) {
		const scopes = memoryScopes(Settings.instance.getAgentDir(), ctx.cwd);
		const categories = scopes.map(scope => t(scope.global ? "globalLabel" : "projectLabel",
			{ entries: usageOf(readMemory(scope.path)).entries, limit: limitsOf(scope).entries }));
		const category = await ctx.ui.select(t("memories"), categories);
		const scope = category === undefined ? undefined : scopes[categories.indexOf(category)];
		if (!scope) return;
		for (;;) {
			const entries = entriesOf(readMemory(scope.path));
			if (!entries.length) { ctx.ui.notify(t(scope.global ? "noGlobal" : "noProject"), "info"); break; }
			// Index prefixes keep labels unique when two memories share the same text.
			const labels = entries.map((entry, index) => {
				const { date, text } = splitDate(entry);
				return `${index + 1}. ${text.replace(/\s+/g, " ")}${date ? `  (${date})` : ""}`;
			});
			const selected = await ctx.ui.select(t(scope.global ? "globalMemories" : "projectMemories"), labels);
			if (selected === undefined) break;
			const entry = entries[labels.indexOf(selected)];
			if (entry !== undefined) await editEntry(scope, entry, ctx);
		}
	}
}

export default function memoryEditor(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => { refreshStatus(ctx); });
	pi.registerCommand("memories", {
		description: t("commandDescription"),
		getArgumentCompletions: prefix => "review".startsWith(prefix)
			? [{ value: "review", label: `review: ${t("reviewDescription")}` }] : null,
		handler: async (args, ctx) => {
			if (!args.trim()) return openMemories(ctx);
			if (args.trim() !== "review") { ctx.ui.notify(t("commandUsage"), "warning"); return; }
			await ctx.waitForIdle();
			const prompt = reviewPrompt(Settings.instance.getAgentDir(), ctx.cwd);
			if (!prompt) { ctx.ui.notify(t("noReviewMemories"), "info"); return; }
			pi.sendMessage({ customType: "memory-review", content: prompt, display: true }, { triggerTurn: true });
		},
	});
}
