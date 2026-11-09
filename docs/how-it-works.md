# How it works

Details behind each part of agent-memory-files. For setup, see the [README](../README.md).

## Files and limits

| Scope | File | Admission bar | Limit |
|---|---|---|---|
| Global | `~/.omp/agent/AGENTS.memory.md` | Standing user-wide contracts or stable personal facts that stay correct in any conversation | 20 entries, 4000 characters |
| Project | `AGENTS.memory.md` in the project root | Durable project decisions, constraints, or preferences that the repository, its docs, configuration, and Git history do not record | 30 entries, 6000 characters |

The project root is the main checkout of the Git repository, so subdirectories and registered worktrees share one file. Outside Git, the working directory is the project.

Each line starting with `- ` is one memory, written as `- [YYYY-MM-DD] text`. Other lines are free-form and kept as they are. Limits count memory lines only.

## Loading

At session start, the extension reads both files and adds them to the system prompt with their paths, bars, and limits, and with instructions for maintaining them. Both files are loaded in full; there is no retrieval step. Edits made during a session apply from the next one.

## Distillation

On session exit or switch, the current branch's user messages, completed assistant replies, and `ask` selections are passed through a credential filter and handed to a detached worker over a pipe. Subagent sessions are skipped: their user messages are the parent agent's task briefs, not the user's words. Sessions removed with `/delete` are skipped too: the worker stores nothing if the transcript no longer exists when the model replies. OMP's shutdown hook has a 2-second limit, so the worker outlives the host. The worker:

1. Sends the conversation, both files' memories, and the remaining room in each file to the `memory` role in one call. The model returns at most 8 candidates, each with a scope and verbatim evidence, applying the bar of its scope and skipping anything already covered.
2. Drops individual candidates with missing evidence, assistant-attributed preferences or decisions, project facts marked global, raw messages, stand-alone dates, or sensitive fields.
3. Appends the rest, dated, to the matching file. Exact duplicates are skipped, and a candidate that would push the file past its limit is not written and is logged as rejected.

Only the option the user actually selected in an `ask` counts as a decision; unselected options are context.

If extraction fails (no model, malformed output, worker failed to start), the job is written to `~/.omp/agent/memories/guidance-queue/` (mode 0600, credential-filtered conversation only) and retried on the next session start, 3 attempts in total. Sessions claim jobs by atomic rename, so a job never runs twice at once; a claim older than 30 minutes is treated as abandoned. A killed OMP process does not trigger extraction.

Worker results go to `~/.omp/logs/memory-guidance.log` as JSON lines: `memory_session_retained` (with `stored` and any `rejected` reasons), `memory_session_requeued`, `memory_session_abandoned`, `memory_queue_invalid`.

## Editing

`/memories` lists the chosen file's memories one per row. Saving an edit replaces only that line and re-dates it; clearing the text deletes the line after confirmation. If the worker or another session changed or removed that memory after the list was shown, nothing is overwritten. Other lines, headings, and comments are kept verbatim.

The worker and the editor take a lock next to the file (`AGENTS.memory.md.lock`) and write through a temporary file and rename, so concurrent sessions never interleave writes. A lock older than 30 seconds belongs to a dead process and is reclaimed. The agent's own file edits do not take the lock.

## Manual review

Choose the model you want in the current conversation, then run `/memories review`. The command sends both files (credential lines hidden) with their bars and limits and starts a normal conversation turn. The current model edits, merges, deletes, and moves entries with its file tools, including into another project's `AGENTS.memory.md` when ownership is clear, and brings each file within its limit. The command itself does not change any file.
