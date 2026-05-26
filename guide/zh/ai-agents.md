# Roll — AI Agent 支持

Roll 支持多种 AI 编码 Agent。每个 Agent 使用相同的约定和技能——切换 Agent 不需要改变工作流。

## 支持的 Agent

| Agent | CLI 命令 | 备注 |
|-------|----------|------|
| Claude Code | `claude` | 默认主 Agent |
| Kimi CLI | `kimi` | 良好备用；支持 peer review |
| DeepSeek TUI | `ai_deepseek` | 本地或 API |
| Codex CLI | `codex` | OpenAI |
| Antigravity (agy) | `agy` | |
| Pi (pi-coding-agent) | `pi` | |
| Trae IDE | （IDE 内置） | project_rules.md 同步 |
| opencode | `opencode` | AGENTS.md 同步 |
| Qwen | `qwen` | 阿里云 / DashScope |

## 切换 Agent

```bash
roll agent use kimi      # 将项目 Agent 设为 kimi
roll agent use claude    # 切换回 claude
roll agent list          # 显示所有已检测到的 Agent 及当前选择
```

活跃 Agent 存储在项目根目录的 `.roll.yaml` 中。每个 roll 技能（`$roll-build`、`$roll-fix` 等）自动路由到已配置的 Agent。

## 项目级与全局

- **项目级**（`.roll.yaml`）：仅对当前项目生效。
- **全局**（`~/.roll/config.yaml`）：无 `.roll.yaml` 时使用。

```yaml
# ~/.roll/config.yaml
loop:
  primary_agent: claude
  fallback_agent: deepseek
```

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
- [loop.md](loop.md) — `loop.primary_agent` / `loop.fallback_agent`
