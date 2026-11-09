# agent-memory-files Agent Guide

This is the canonical agent guide for this repository. `CLAUDE.md` is a symlink to it; edit this file only.

## Project

Long-term memory for coding agents as two Markdown files (global and per project), with an oh-my-pi (OMP) extension that loads them at session start, distills new memories when a session ends, and offers a `/memories` editor and review. OMP loads `index.ts`, declared in `package.json` under `omp.extensions`.

## Repository Map

- `index.ts`: entry point; sets the UI locale, then registers the two modules.
- `src/memory-file.ts`: file locations, limits, parsing, locked writes, and the session-start memory context.
- `src/extension.ts`, `src/review.ts`: `/memories` editor, `/memories review` prompt, status bar.
- `src/session.ts`, `src/worker.ts`, `src/guidance.ts`, `src/queue.ts`: distillation in a detached worker, candidate validation, retry queue.
- `src/policy.ts`: credential detection.
- `src/i18n.ts`: UI strings in English and Simplified Chinese.
- `test/`: Bun tests on temporary directories.
- `docs/how-it-works.md`: behavior reference linked from the README.

## Rules

- UI text goes through `t()` in `src/i18n.ts`, with both locales updated together. Model prompts, the injected memory context, and log events stay English.
- Plugin writes to memory files go through `writeMemory` or `appendMemories`, which take the file lock and write atomically.
- Never send credential-bearing text to a model or into the prompt; use `hasSecret()` from `src/policy.ts`.
- Requests must never be blocked by memory failures: report once and continue.
- Tests must not touch a real OMP agent directory or project.
- Keep `README.md` and `README_CN.md` in sync, and add user-visible changes to `CHANGELOG.md` under `Unreleased`.

## Commands

```bash
bun test
```
