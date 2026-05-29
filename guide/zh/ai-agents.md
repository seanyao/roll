# Roll — AI Agent 支持

Roll 支持多种 AI 编码 Agent。每个 Agent 使用相同的约定和技能——切换 Agent 不需要改变工作流。

`openai` Agent 名称是通往 Codex CLI（`codex`）的别名。使用 `roll agent use openai` 选择它——实际调用的是同一个二进制文件。

## 支持的 Agent

| Agent | CLI 命令 | 备注 |
|-------|----------|------|
| Claude Code | `claude` | 默认主 Agent |
| Kimi CLI | `kimi-code`（旧版回退：`kimi-cli` / `kimi`） | 良好备用；支持 peer review。配置目录：`~/.kimi-code/`（旧版 `~/.kimi/` 仍可识别） |
| DeepSeek TUI | `ai_deepseek` | 本地或 API |
| Codex CLI | `codex` | OpenAI |
| OpenAI（别名） | `openai` | `codex` 的别名。安装：`npm install -g @openai/codex` |
| Antigravity | `agy` | Google Gemini CLI 的继任者，复用 `~/.gemini/` 与 `GEMINI.md`。用 `roll agent use antigravity` 选择（旧别名 `gemini` 仍可识别）。安装：`npm install -g @antigravity/agy` |
| Pi (pi-coding-agent) | `pi` | |
| Trae IDE | （IDE 内置） | project_rules.md 同步 |
| opencode | `opencode` | AGENTS.md 同步 |
| Qwen | `qwen` | 阿里云 / DashScope |

## 复杂度路由（四个槽）

Roll 按**任务复杂度**把活儿派给 agent。故事的 `est_min` 归到三档之一，每档由
`.roll/agents.yaml` 的四个槽映射到具体 agent：

```yaml
schema: v3
easy:     { agent: kimi }      # est_min <= 8
default:  { agent: kimi }      # 8 < est_min <= 20（也是兜底默认档）
hard:     { agent: claude }    # est_min > 20
fallback: { agent: pi }        # 选中的 agent 离线时顶上
```

每个 agent 用自己的默认模型 —— 没有 model 层要配。

```bash
roll agent                # 查看四个槽 + 在线状态 + 最近降级痕迹
roll agent list           # 显示本机已装的所有 agent
roll agent set hard claude   # 改某一档的 agent
roll agent use kimi       # 把 easy/default/hard 三档全锁成一个（fallback 不动）
```

`roll agent use <name>` 保留了老的单 agent 习惯 —— 现在含义升级为「把三个复杂度档
全锁成这个 agent」。每个 roll 技能（`$roll-build`、`$roll-fix` 等）和 loop 都自动
按这些槽路由。

## Per-Machine，不进 git

`.roll/agents.yaml` 是 **per-machine** 的：它列在 `.roll/.gitignore` 里，绝不
commit，所以每台机器各管各的 agent 槽。这样一台机器的 agent 选择不会泄漏到另一台
（或进共享的 meta repo）。不再有全局 `primary_agent` / `fallback_agent` 配置项 ——
路由完全由项目本地的复杂度槽决定。

## 约定同步

`roll setup` 将全局约定（`AGENTS.md`、`CLAUDE.md`）复制到每个检测到的 AI 工具的预期目录。新增 Agent 后重新运行：

```bash
roll setup
```

## 多 Agent Peer Review

`$roll-peer` 将设计或代码决策路由到第二个 AI Agent 进行交叉验证。路由按 capability map — 若主 Agent 是 Claude，Peer 默认使用 Kimi 或 DeepSeek。

详见 [peer.md](peer.md)。

## 另见

- [configuration.md](configuration.md) — Agent 配置项
- [peer.md](peer.md) — 跨 Agent peer review
- [loop.md](loop.md) — 自主 loop 里的复杂度 agent 路由
