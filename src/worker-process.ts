import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enqueue, MAX_ATTEMPTS, release, type WorkerPayload } from "./queue";

/** Inherit a regular file on fd 3 so host exit cannot truncate an unfinished pipe write. */
export function dispatch(cwd: string, payload: WorkerPayload, logPath: string, workerArgs: string[]): void {
	mkdirSync(payload.queueDir, { recursive: true, mode: 0o700 });
	const name = `${payload.job.sessionId}-${payload.job.sourceEntry}`.replace(/[^\w.-]/g, "_");
	const claimed = payload.claimed ?? join(payload.queueDir, `${name}.json.${process.pid}-${randomBytes(4).toString("hex")}.claimed`);
	payload = { ...payload, claimed };
	writeFileSync(claimed, JSON.stringify(payload), { mode: 0o600 });
	const report = (error: Error) => {
		const attempts = payload.attempts + 1;
		const requeue = attempts < MAX_ATTEMPTS;
		appendFileSync(logPath, JSON.stringify({ event: requeue ? "memory_session_requeued" : "memory_session_abandoned",
			sessionId: payload.job.sessionId, error: error.message }) + "\n");
		if (requeue) enqueue(payload.queueDir, payload.job, attempts);
		release(claimed);
	};
	let log: number | undefined;
	let input: number | undefined;
	try {
		log = openSync(logPath, "a", 0o600);
		input = openSync(claimed, "r");
		const child = spawn(process.execPath, workerArgs, {
			cwd, detached: true, stdio: ["ignore", "ignore", log, input],
		});
		child.on("error", report);
		child.unref();
	} catch (error) {
		report(error instanceof Error ? error : new Error(String(error)));
	} finally {
		if (input !== undefined) closeSync(input);
		if (log !== undefined) closeSync(log);
	}
}
