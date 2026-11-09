# How it works

Details behind each part of omp-mnemopi-memory. For setup, see the [README](../README.md).

## Global injection

Before each request, the extension injects all active, non-sensitive global memories into `<global_memories>`, without task relevance filtering or dependence on recall hits. Global memory is the user's standing contract or stable profile across conversations; project-specific knowledge belongs in project memory. Quality is controlled at admission, not by hiding entries at retrieval. Entries are ranked as follows:

| Rank | Source |
|---|---|
| 1 | Memories you edited (`user-memory-editor`) or corrected (`user-correction`) |
| 2 | Other memories, by importance, then recency |
| 3 | Mnemopi facts whose source memory is not injected |

- If the context window cannot fit all of them, the lowest-ranked entries are dropped and the model is told how many were omitted.
- Memories containing credentials (passwords, API keys, tokens, auth URLs; English and Chinese keywords) are never injected.
- If the database cannot be read, the request proceeds without global memories and you get one warning. Requests are never blocked.
- Global memories duplicated by built-in Mnemopi recall are removed from the `<memories>` block; project and ambiguous recalls stay. A truncated recall item must match at least 20 characters of a global memory.
- Each entry shows the date its memory was created, so the model can judge staleness.

## Distillation

On session exit or switch, the current branch's user messages, completed assistant replies, and `ask` selections are passed through a credential filter and handed to a detached worker over a pipe. Subagent sessions are skipped: their user messages are the parent agent's task briefs, not the user's words. OMP's shutdown hook has a 2-second limit, so the worker outlives the host. The worker:

1. Asks the `memory` role for at most 8 candidates with verbatim evidence. Each must contain one durable fact, change a future action, and not be cheaply recoverable from files, configuration, tools, or existing instructions. Trials, current settings, tool adoption, configuration dumps, directory inventories, migrations, work reports, and assistant-only assertions do not qualify. Bundling a lasting preference with a setup snapshot does not make the snapshot admissible.
2. Drops individual candidates with missing evidence, assistant-attributed preferences or decisions, raw messages, stand-alone dates, or sensitive fields.
3. Removes exact duplicates and saves accepted candidates with source `omp-auto-guidance`. Semantic deduplication and retirement checks happen in the extraction prompt, with active and retired memories as input. There is only one model call, with no automatic second review. If the target is global, project facts are also rejected in code.

Only the option the user actually selected in an `ask` counts as a decision; unselected options are context.

Explicit retains receive the same admission policy as an instruction to the main agent. Global memory must remain valid regardless of the current project, task, or topic. User-wide conditional interaction rules can qualify without triggering in every reply. App configuration and repository, host, or project-workflow constraints stay project-local even when phrased as "always". Every admitted global memory is injected on every request, subject only to credential/validity filtering and the context-capacity fallback above. Semantic admission remains a model judgment.

If extraction fails (no model, malformed output, worker failed to start), the job is written to `~/.omp/agent/memories/guidance-queue/` (mode 0600, credential-filtered conversation only) and retried on the next session start, 3 attempts in total. Sessions claim jobs by atomic rename, so a job never runs twice at once; a claim older than 30 minutes is treated as abandoned. A killed OMP process does not trigger extraction. Setting `mnemopi.llmMode: none` disables dispatch.

Worker results go to `~/.omp/logs/memory-guidance.log` as JSON lines: `memory_session_retained` (with `stored` and any `rejected` reasons), `memory_session_requeued`, `memory_session_abandoned`, `memory_queue_invalid`.

## Manual review

Choose the model you want in the current conversation, then run `/memories review`. The command snapshots active global and current-project memories plus retired working-memory feedback, filters credential-bearing content, and starts a normal conversation turn. It does not select a stronger model automatically, invoke the `memory` role, or delegate the review.

The current model reviews scope, durability, conflicts, and duplication, then uses its existing tools to edit, merge, move, or retire entries. The request includes the extension's storage API for conflict-checked edits and deletions; scope moves must save and verify the destination before retiring the source. Unrelated projects are excluded, and ambiguous decisions are left for the user. The command itself does not mutate memories.

The review request is a custom session message, not a user statement supplied to automatic extraction. Saved changes and unresolved decisions are reported in the conversation. This is an explicitly requested agent task, not a deterministic cleanup algorithm.


## Projects

A Git project is identified by its common repository: the main checkout, subdirectories, and registered worktrees share memories, and identical entries are shown once. Nested independent repositories stay separate. Outside Git, the nearest ancestor directory that already has memories defines the project.

## Saving and deleting

All writes go through the official Mnemopi API with models, embeddings, and automatic fact extraction disabled. Saving creates a new record and invalidates the old one; deleting invalidates it. Facts derived from an invalidated record are retired with it. Identical text across banks in the same scope is updated together. Each write checks that the record is still active and unchanged; if another session modified it, the write is refused.

Global injection and archiving read Mnemopi tables directly. Required columns are verified on each read, so a schema change surfaces as a clear read error instead of silently wrong data. After upgrading OMP or Mnemopi, run the tests.
