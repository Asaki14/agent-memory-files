# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Breaking
- Renamed from omp-mnemopi-memory to agent-memory-files. The locale config file is now `~/.omp/agent/agent-memory-files.json`.
- Memory moved from the Mnemopi backend to two Markdown files: `~/.omp/agent/AGENTS.memory.md` (global) and `AGENTS.memory.md` in each project root. Both are loaded in full at session start. Set `memory.backend` to `off`; the Mnemopi dependency, global injection, recall de-duplication, and transcript archiving are removed.
- Global and project memory have separate admission bars and limits (20 entries / 4000 characters global, 30 entries / 6000 characters per project). Distillation stops writing to a full file.
- `/memories` edits a whole file; `/memories review` edits files with the agent's tools and can move memories into another project's file.

### Added
- Install as an OMP plugin with `omp plugin install github:Asaki14/agent-memory-files`.
- Simplified Chinese interface, selected by `locale` in `agent-memory-files.json` or the POSIX locale.
- GitHub Actions workflow running the test suite.
- Chinese README, `llms.txt` for agent-driven installs, and an agent guide in `AGENTS.md`.
- `/memories review` starts an explicit review and cleanup using the current conversation's model and tools, with argument completion.
- `/memories review` can move a memory to global memory or to the project it belongs to, when that project already has a memory bank.

### Changed
- Sources moved to `src/` and tests to `test/`; detailed behavior moved to `docs/how-it-works.md`.
- The worker log is written to `logs/memory-guidance.log` next to the OMP agent directory, regardless of where the extension is installed.
- Global memories show their creation date.
- Facts Mnemopi derived from an injected global memory are no longer injected again as separate entries.
- Distillation keeps only project facts that stay useful and cannot be rediscovered from the repository, and drops work reports, QA results, measurements, and commit hashes.
- Global memory admission now requires a standing user contract or stable profile valid across conversations, not merely usefulness in several projects; global injection remains full-bank and does not filter by task relevance.
- Automatic distillation uses one model call, incorporating known and retired memories in the extraction prompt; the automatic second admission and duplication review has been removed.

### Fixed
- On a fresh install, reading memories before Mnemopi created its database no longer raises `unable to open database file`.
- Subagent sessions are no longer distilled; their task briefs were being saved as user decisions.
- Memories saved in `/memories` and distilled automatically are written under the bank's own session id, so OMP's `memory_edit` can update and forget them instead of reporting `not found`. Rows written by earlier versions need their `session_id` set to the bank name once.
- Each memory entry now lives in one bank. Identical text in global and project memory is listed separately instead of being edited together, so an edit or deletion can no longer apply to only some banks.
- Sessions removed with `/delete` no longer leave distilled memories; the worker stores nothing once the session's transcript is gone.

## [0.1.0] - 2026-10-27

### Added
- `/memories` editor for global and current-project Mnemopi memories.
- Global memory injection ranked by source and importance, trimmed to the context budget, with credential filtering.
- Removal of global memories duplicated by built-in Mnemopi recall.
- Session-end distillation in a detached worker, with evidence checks, per-candidate rejection, semantic deduplication, and a retry queue.
- Archiving of raw `coding-agent-transcript` memories and everything derived from them.

[Unreleased]: https://github.com/Asaki14/agent-memory-files/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Asaki14/agent-memory-files/releases/tag/v0.1.0
