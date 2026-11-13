import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Settings, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { t } from "./i18n";
import { conversationFromMessages, safeConversation } from "./guidance";
import { memoryContext, memoryScopes } from "./memory-file";
import { claimQueued, queueDirectory, release, type WorkerPayload } from "./queue";
import { dispatch } from "./worker-process";

const workerPath = join(import.meta.dir, "worker.ts");
/** `~/.omp/logs/memory-guidance.log` for the default agent dir; independent of where the extension is installed. */
function logPath(): string {
	const directory = join(dirname(Settings.instance.getAgentDir()), "logs");
	mkdirSync(directory, { recursive: true });
	return join(directory, "memory-guidance.log");
}

/** Run extraction in a detached worker; shutdown hooks have a 2s deadline and extraction must outlive the host. */
function dispatchWorker(cwd: string, payload: WorkerPayload): void {
	dispatch(cwd, payload, logPath(), ["--mode", "rpc", "--no-session", "--no-tools", "--no-extensions",
		"--no-context-files", "--no-skills", "--no-title", "--cwd", cwd, "-e", workerPath]);
}

export default function memoryGuidance(pi: ExtensionAPI): void {
	let lastHandled = "";
	let context = "";
	pi.on("session_start", (_event, ctx) => {
		context = memoryContext(Settings.instance.getAgentDir(), ctx.cwd);
		const queueDir = queueDirectory(Settings.instance.getAgentDir());
		for (const claimed of claimQueued(queueDir)) {
			try {
				const { job, attempts } = JSON.parse(readFileSync(claimed, "utf8")) as Pick<WorkerPayload, "job" | "attempts">;
				dispatchWorker(job.cwd, { job, attempts, queueDir, claimed });
			} catch (error) {
				appendFileSync(logPath(), JSON.stringify({ event: "memory_queue_invalid", file: claimed,
					error: error instanceof Error ? error.message : String(error) }) + "\n");
				release(claimed);
			}
		}
	});
	pi.on("before_agent_start", (event) => {
		if (context) return { systemPrompt: [...event.systemPrompt, context] };
	});
	const finishSession = async (_event: unknown, ctx: ExtensionContext): Promise<void> => {
		// Subagent "user" messages are the parent's task briefs, not the user's words.
		if (ctx.agent?.kind === "sub") return;
		const branch = ctx.sessionManager.getBranch();
		const sourceEntry = branch.at(-1)?.id;
		if (!sourceEntry) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const key = `${sessionId}:${sourceEntry}`;
		if (key === lastHandled) return;
		const messages = safeConversation(conversationFromMessages(branch.filter(entry => entry.type === "message").map(entry => entry.message)));
		if (!messages.some(message => message.role === "user") || !messages.some(message => message.role === "assistant")) return;
		try {
			const [global, project] = memoryScopes(Settings.instance.getAgentDir(), ctx.cwd);
			lastHandled = key;
			dispatchWorker(ctx.cwd, {
				job: { global, project, cwd: ctx.cwd, sessionId, sourceEntry, sessionFile: ctx.sessionManager.getSessionFile(), conversation: messages },
				attempts: 0, queueDir: queueDirectory(Settings.instance.getAgentDir()),
			});
		} catch (error) {
			ctx.ui.notify(t("extractionFailed", { error: error instanceof Error ? error.message : String(error) }), "warning");
		}
	};
	pi.on("session_before_switch", finishSession);
	pi.on("session_shutdown", finishSession);
}
