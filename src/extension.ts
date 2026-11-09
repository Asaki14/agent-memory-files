import { Settings, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { t } from "./i18n";
import { limitsOf, memoryScopes, MemoryConflictError, readMemory, usageOf, writeMemory, type MemoryScope } from "./memory-file";
import { reviewPrompt } from "./review";

function refreshStatus(ctx: ExtensionContext): void {
	const count = memoryScopes(Settings.instance.getAgentDir(), ctx.cwd)
		.reduce((sum, scope) => sum + usageOf(readMemory(scope.path)).entries, 0);
	ctx.ui.setStatus("global-memory", t("status", { count }));
}

function label(scope: MemoryScope): string {
	const usage = usageOf(readMemory(scope.path));
	const limit = limitsOf(scope);
	return t(scope.global ? "globalLabel" : "projectLabel", { entries: usage.entries, limit: limit.entries });
}

async function editFile(scope: MemoryScope, ctx: ExtensionCommandContext): Promise<void> {
	const original = readMemory(scope.path);
	const edited = await ctx.ui.editor(t("editTitle", { path: scope.path }), original);
	if (edited === undefined || edited === original) return;
	try {
		writeMemory(scope, original, edited);
	} catch (error) {
		ctx.ui.notify(error instanceof MemoryConflictError ? t("conflict") : String(error), "error");
		return;
	}
	refreshStatus(ctx);
	const usage = usageOf(edited);
	const limit = limitsOf(scope);
	if (usage.entries > limit.entries || usage.chars > limit.chars) {
		ctx.ui.notify(t("overLimit", { entries: usage.entries, chars: usage.chars, maxEntries: limit.entries, maxChars: limit.chars }), "warning");
	} else ctx.ui.notify(t("saved"), "info");
}

async function openMemories(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) { ctx.ui.notify(t("needsUI"), "error"); return; }
	await ctx.waitForIdle();
	for (;;) {
		const scopes = memoryScopes(Settings.instance.getAgentDir(), ctx.cwd);
		const labels = scopes.map(label);
		const selected = await ctx.ui.select(t("memories"), labels);
		const scope = selected === undefined ? undefined : scopes[labels.indexOf(selected)];
		if (!scope) return;
		await editFile(scope, ctx);
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
