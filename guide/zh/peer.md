# roll peer — 跨 Agent 代码评审

`roll peer` 把方案或代码变更发给第二个 AI Agent 评审。
Loop 在高风险构建前会自动触发；你也可以随时手动调用。

## 工作原理

```
roll peer --from claude --to kimi --context plan.md

  Claude 提交方案 → Kimi 评审 → 返回裁决
```

Peer review 是一轮或多轮协商：

| 裁决 | 含义 | 后续动作 |
|------|------|---------|
| **AGREE** | 方案通过 | 继续构建 |
| **REFINE** | 需要调整 | 吸收反馈后重新提交 |
| **OBJECT** | 有实质分歧 | 重新考量方案后再提交 |
| **ESCALATE** | 协商无法收敛 | 需要人工决策 |

连续 3 轮未达到 AGREE 时，自动升级为 ESCALATE。

## 命令参考

```bash
# 基本用法：让 kimi 评审 claude 的方案
roll peer --from claude --to kimi --context plan.md

# 自动选择 peer（根据能力表路由）
roll peer --from claude

# 指定轮次（loop 内部多轮调用时使用）
roll peer --from claude --to kimi --round 2 --context plan.md

# 跳过 10 秒倒计时确认
roll peer --from claude --yes

# 按标签路由（如 "security"、"architecture"）
roll peer --from claude --tag security

# 查看 peer 对的健康状态
roll peer status

# 重置降级或废弃的 peer 对
roll peer reset claude kimi
```

## 自动触发条件

Loop（以及 `$roll-build`）在以下情况自动触发 peer review：

- 方案涉及超过 3 个文件或跨越模块边界
- 包含架构决策或不显而易见的取舍
- 破坏性操作（删除、迁移、生产部署）
- 请求中出现高风险信号词："critical"、"don't break"、"关键"、"别搞砸"

触发前会显示 10 秒倒计时，可输入 `n` 跳过：

```
方案涉及 5 个文件，跨越 3 个模块。预计 peer review：2–3 轮。
按 Enter 执行，或输入 n 跳过。10 秒后自动执行...
```

## 能力表（Capability Map）

默认路由顺序：`kimi → claude → pi`。

在 `~/.roll/config.yaml` 中配置：

```yaml
peer_capability_map_default: "kimi claude pi"
peer_capability_map_security: "kimi deepseek claude"
peer_capability_map_architecture: "claude kimi"
```

支持的 peer Agent：`claude`、`kimi`、`pi`、`deepseek`、`codex`、`openai`、`opencode`。
未安装的 Agent 会被自动跳过。

## 可见性（tmux + 弹窗）

与 loop 一样，peer review 在 tmux session（`roll-peer-<from>-<to>`）里运行。
未静音时，终端窗口自动弹出，你可以实时看到跨 AI 协商过程。

Session 在多轮协商期间保持存活，你可以用一个窗口看完整个多轮协商。
终态决议（AGREE、ESCALATE、UNKNOWN、或 round ≥ 3）后，session 会自动清理 ——
tmux session 被终止，终端窗口随后关闭。

`mute` 文件（`~/.shared/roll/mute`）对 loop 和 peer 同时生效。
`roll loop mute` / `roll loop unmute` 控制所有自主活动的弹窗。

## Peer 对状态机

每个 `from→to` 对维护一个健康状态：

| 状态 | 含义 |
|------|------|
| `active` | 健康，最近一次裁决为 AGREE |
| `degraded` | 连续 1–2 次非 AGREE |
| `abandoned` | 连续 3+ 次失败 — peer 对已停用 |

用 `roll peer status` 查看状态，用 `roll peer reset <from> <to>` 重置。

## 评审日志

每次 peer review 的日志保存在：

```
~/.local/share/roll/peer/logs/YYYYMMDD_HHMMSS_<from>_<to>.md
```

日志包含每一轮的完整提示词和响应内容。
