<div align="center">
  <img src="https://raw.githubusercontent.com/Asaki14/omp-mnemopi-memory/main/assets/logo.svg" width="120" />
  <h1>omp-mnemopi-memory</h1>
  <p><b>让编码 Agent 的记忆保持干净，也让你看得懂</b></p>
  <p><a href="README.md">English</a> · 中文</p>
  <a href="https://github.com/Asaki14/omp-mnemopi-memory/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/Asaki14/omp-mnemopi-memory/test.yml?branch=main&style=flat-square&label=tests" alt="Tests"></a>
  <a href="https://github.com/Asaki14/omp-mnemopi-memory/stargazers"><img src="https://img.shields.io/github/stars/Asaki14/omp-mnemopi-memory?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/Asaki14/omp-mnemopi-memory/tags"><img src="https://img.shields.io/github/v/tag/Asaki14/omp-mnemopi-memory?label=version&style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License"></a>
</div>

<br/>

<div align="center">
  <img src="https://raw.githubusercontent.com/Asaki14/omp-mnemopi-memory/main/assets/flow.svg" width="1000" />
</div>

## 功能

一个 [oh-my-pi（OMP）](https://github.com/can1357/oh-my-pi) 扩展：把长期记忆存成两个普通 Markdown 文件，会话开始时全部加载。

| 功能 | 什么时候 | 做什么 |
| :--- | :--- | :--- |
| 全局记忆 | 每次会话 | `~/.omp/agent/AGENTS.memory.md`，门槛最高：只收在任何对话里都成立的个人约定和稳定信息；上限 20 条、4000 字。 |
| 项目记忆 | 在该项目的每次会话 | 项目根目录的 `AGENTS.memory.md`（Git worktree 共用主仓库的文件），只收仓库里查不到、之后仍有用的项目决定和约束；上限 30 条、6000 字。 |
| 会话提炼 | 主会话结束 | 后台调用一次 `memory` 模型，提取有原话作证、长期有效的事实，按门槛分别写入全局或项目文件；文件满了就不再写入。subagent 会话和用 `/delete` 删除的会话不提炼，失败任务下次启动重试。 |
| Agent 维护 | 会话中 | Agent 知道两个文件的位置和门槛，可以直接用文件工具新增、修改、合并、删除，或把记忆移到所属项目的文件。 |
| `/memories` | 想查看或修改 | 选择全局或项目，在编辑器里直接改整份文件。 |
| `/memories review` | 手动触发整理 | 用当前对话的模型精简、合并、删除记忆，把放错位置的记忆移到全局或所属项目，并把文件压回上限以内。 |

## 安装

```bash
omp plugin install github:Asaki14/omp-mnemopi-memory
```

然后在 `~/.omp/agent/config.yml` 中关闭 OMP 自带记忆，指定提炼用的模型，执行 `/reload`：

```yaml
memory:
  backend: "off"
modelRoles:
  memory: <provider>/<model>    # 远程模型；本地模型会被跳过
```

`AGENTS.memory.md` 只属于你自己，建议加入全局 Git 忽略，避免提交到仓库：

```bash
printf 'AGENTS.memory.md\nAGENTS.memory.md.lock\n' >> ~/.config/git/ignore
```

也可以直接让 Agent 帮你装：
> Install omp-mnemopi-memory for me by reading https://github.com/Asaki14/omp-mnemopi-memory/blob/main/llms.txt

## 使用

每行以 `- ` 开头为一条记忆，格式是 `- [日期] 内容`；标题和其他文字可以随意写。所有改动从下一次会话起生效。

执行 `/memories` 选择全局或项目，在编辑器里修改；超出上限也能保存，但会提醒你精简。也可以直接用任何编辑器打开文件。需要模型整理时，先切到你想用的模型，再执行 `/memories review`。

界面支持英文和简体中文，默认跟随 `LC_ALL`、`LC_MESSAGES` 或 `LANG`，也可以在 `~/.omp/agent/omp-mnemopi-memory.json` 里固定：

```json
{ "locale": "zh-CN" }
```

发给模型的提示词始终是英文；提炼出的记忆跟随你主要使用的语言。

后台结果记录在 `~/.omp/logs/memory-guidance.log`。完整流程和重试机制见 [How it works](docs/how-it-works.md)。

## 为什么

自动保存整段对话的记忆系统，会把旧提示词、一次性命令和放弃的计划当成长期指令带回来，而且你很难看到里面存了什么。

这个扩展反过来做：少记，并且全部看得见。记忆就是两个文件，打开就能读能改；门槛和上限防止它们越写越长。

## 卸载

```bash
omp plugin uninstall omp-mnemopi-memory
rm -rf ~/.omp/agent/memories/guidance-queue
rm -f ~/.omp/agent/omp-mnemopi-memory.json
```

`AGENTS.memory.md` 文件保留，需要时手动删除。

## 参与贡献

欢迎提 Issue 和 PR。提交前请运行 `bun test`，并把用户可感知的改动写进 [CHANGELOG.md](CHANGELOG.md) 的 `Unreleased`。面向 Agent 的仓库说明见 [AGENTS.md](AGENTS.md)。

## 许可证

MIT License，欢迎使用和参与贡献。
