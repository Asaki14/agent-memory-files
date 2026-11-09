<div align="center">
  <img src="https://raw.githubusercontent.com/Asaki14/agent-memory-files/main/assets/logo.svg" width="120" />
  <h1>agent-memory-files</h1>
  <p><b>Memory your coding agent keeps clean, and you can actually read.</b></p>
  <p>English · <a href="README_CN.md">中文</a></p>
  <a href="https://github.com/Asaki14/agent-memory-files/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/Asaki14/agent-memory-files/test.yml?branch=main&style=flat-square&label=tests" alt="Tests"></a>
  <a href="https://github.com/Asaki14/agent-memory-files/stargazers"><img src="https://img.shields.io/github/stars/Asaki14/agent-memory-files?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/Asaki14/agent-memory-files/tags"><img src="https://img.shields.io/github/v/tag/Asaki14/agent-memory-files?label=version&style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License"></a>
</div>

<br/>

<div align="center">
  <img src="https://raw.githubusercontent.com/Asaki14/agent-memory-files/main/assets/flow.svg" width="1000" />
</div>

## Features

Long-term memory for coding agents, kept in two plain Markdown files: one global, one per project. Any agent can read and edit them. The [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi) extension in this repository adds the automation: loading at session start, distillation when a session ends, and the `/memories` editor and review.

| Feature | When | What it does |
| :--- | :--- | :--- |
| Global memory | Every session | `~/.omp/agent/AGENTS.memory.md`, with the strictest bar: only personal contracts and stable facts that hold in any conversation. Limit 20 entries, 4000 characters. |
| Project memory | Every session in that project | `AGENTS.memory.md` in the project root (Git worktrees share the main checkout's file), for durable project decisions and constraints the repository does not record. Limit 30 entries, 6000 characters. |
| Session distillation | A main session ends | One background call to the `memory` model extracts evidenced, durable facts and writes each to the global or project file according to its bar; a full file takes no more. Subagent sessions and sessions removed with `/delete` are skipped; failed runs retry on the next start. |
| Agent upkeep | During a session | The agent knows both files, their bars, and limits, and adds, edits, merges, deletes, or moves memories to their own project's file with its file tools. |
| `/memories` | You want to see or change memory | Pick global or project and edit the whole file in the editor. |
| `/memories review` | You explicitly request cleanup | The current conversation's model trims, merges, and deletes entries, moves misplaced ones to global memory or their own project, and brings each file back within its limit. |

## Install

```bash
omp plugin install github:Asaki14/agent-memory-files
```

Then turn off OMP's built-in memory, choose the distillation model in `~/.omp/agent/config.yml`, and run `/reload`:

```yaml
memory:
  backend: "off"
modelRoles:
  memory: <provider>/<model>    # a remote model; local models are skipped
```

`AGENTS.memory.md` is personal; add it to your global Git ignore so it never gets committed:

```bash
printf 'AGENTS.memory.md\nAGENTS.memory.md.lock\n' >> ~/.config/git/ignore
```

You can also tell your agent to install it:
> Install agent-memory-files for me by reading https://github.com/Asaki14/agent-memory-files/blob/main/llms.txt

## Usage

Each line starting with `- ` is one memory, written as `- [date] text`; headings and other text are free-form. Changes apply from the next session.

Run `/memories`, pick global or project, and edit the file. Saving over the limit works but warns you to trim. Any editor works too. For model-assisted cleanup, select the model you want and run `/memories review`.

The interface is in English or Simplified Chinese. It follows `LC_ALL`, `LC_MESSAGES`, or `LANG`, and you can pin it in `~/.omp/agent/agent-memory-files.json`:

```json
{ "locale": "zh-CN" }
```

Prompts sent to models stay in English. Distilled memories are written in the language you mainly used.

Worker results are logged to `~/.omp/logs/memory-guidance.log`. The full pipeline and retry behavior are in [How it works](docs/how-it-works.md).

## Other agents

The memory files work without OMP; only the automation above is OMP-specific. Point other agents at the same files so they share one memory:

- Claude Code: add `@~/.omp/agent/AGENTS.memory.md` to `~/.claude/CLAUDE.md`, and `@AGENTS.memory.md` to a project's `CLAUDE.md`.
- Agents without file imports (for example Codex): add a line to their `AGENTS.md` telling them to read `~/.omp/agent/AGENTS.memory.md` and the project's `AGENTS.memory.md` at the start of a task, and to follow the format and limits stated in each file's header.

## Why

Memory systems that save whole conversations bring old prompts, one-off commands, and abandoned plans back as standing instructions, and you cannot easily see what was stored.

This extension takes the opposite stance: remember less, and make all of it visible. Memory is two files you can open and edit; admission bars and limits keep them from growing without end.

## Uninstall

```bash
omp plugin uninstall agent-memory-files
rm -rf ~/.omp/agent/memories/guidance-queue
rm -f ~/.omp/agent/agent-memory-files.json
```

`AGENTS.memory.md` files are kept; delete them by hand if you no longer want them.

## Contributing

Issues and pull requests are welcome. Run `bun test` before submitting, and note user-visible changes under `Unreleased` in [CHANGELOG.md](CHANGELOG.md). Agent-facing repository notes live in [AGENTS.md](AGENTS.md).

## License

MIT License. Feel free to use it and contribute.
