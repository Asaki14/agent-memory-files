import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Writable } from "node:stream";
import { Settings, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { t } from "./i18n";
import { conversationFromMessages, safeConversation } from "./guidance";
import { memoryContext, memoryScopes } from "./memory-file";
import { claimQueued, enqueue, MAX_ATTEMPTS, queueDirectory, release, type WorkerPayload } from "./queue";

const workerPath = join(import.meta.dir, "worker.ts");
/** `~/.omp/logs/memory-guidance.log` for the default agent dir; independent of where the extension is installed. */
function logPath(): string {
	const directory = join(dirname(Settings.instance.getAgentDir()), "logs");
	mkdirSync(directory, { recursive: true });
	return join(directory, "memory-guidance.log");
}

/** Run extraction in a detached worker; shutdown hooks have a 2s deadline and extraction must outlive the host. */
function dispatch(cwd: string, payload: WorkerPayload): void {
	const report = (error: Error) => {
		const attempts = payload.attempts + 1;
		const requeue = attempts < MAX_ATTEMPTS;
		appendFileSync(logPath(), JSON.stringify({ event: requeue ? "memory_session_requeued" : "memory_session_abandoned",
			sessionId: payload.job.sessionId, error: error.message }) + "\n");
		if (requeue) enqueue(payload.queueDir, payload.job, attempts);
		release(payload.claimed);
	};
	const log = openSync(logPath(), "a", 0o600);
	try {
		const child = spawn(process.execPath, ["--mode", "rpc", "--no-session", "--no-tools", "--no-extensions",
			"--no-context-files", "--no-skills", "--no-title", "--cwd", cwd, "-e", workerPath], {
			cwd, detached: true, stdio: ["ignore", "ignore", log, "pipe"],
		});
		let failed = false;
		const fail = (error: Error) => { if (!failed) { failed = true; report(error); } };
		child.on("error", fail);
		const input = child.stdio[3] as Writable;
		child.unref();
		input.on("error", fail);
		input.end(JSON.stringify(payload));
	} finally { closeSync(log); }
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
				dispatch(job.cwd, { job, attempts, queueDir, claimed });
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
			dispatch(ctx.cwd, {
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
