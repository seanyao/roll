# Roll — 配置

Roll 在启动时解析三个环境变量。在运行 `roll` 之前覆盖任意一个，
就能改变它查找状态、技能和共享约定的位置。

## 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `ROLL_HOME` | `~/.roll` | 单用户状态根目录。存放 `config.yaml`、已安装的 `skills/`、同步的 `conventions/`。 |
| `ROLL_CONFIG` | `$ROLL_HOME/config.yaml` | Agent 路由、活跃窗口、调度计划、单工具配置。 |
| `ROLL_GLOBAL` | `$ROLL_HOME/conventions/global` | 全局约定文件（`AGENTS.md`、`CLAUDE.md` 等），同步到各 AI 工具目录。 |
| `ROLL_HEARTBEAT_TIMEOUT` | `1800`（秒） | loop runner 认定 inner cycle 已成孤儿、需要 heal state 的心跳静默阈值。如果你的 cycle 合理静默时间超过 30 分钟，可调大此值。 |
| `ROLL_LOOP_FORCE` | 未设置 | 设为任意非空值时，`roll loop` 会跳过活跃窗口和 pause 文件检查。`roll loop now` 和 `roll loop test` 内部已自动设置；只有当你希望 cron 定时调度也忽略静默时段时，才需要手动 export。 |
| `ROLL_LOOP_NO_HEAL` | `0` | 设为 `1` 关闭构建完成后的 CI 自愈，恢复 fail-fast。调试或想给自主循环按周期省钱时使用。 |
| `ROLL_LOOP_HEAL_MAX` | `2` | 故事提交落地后，CI 自愈的最大尝试次数。CI 抖动较多时可调大；想更快失败则调小。 |
| `ROLL_PR_MERGE_TIMEOUT` | `600`（秒） | `_loop_wait_pr_merge` 等待已开启 PR 合并（或失败）的最长时间，超时后放弃并写 ALERT。CI 慢就调大，CI 快可调小。 |
| `ROLL_LOOP_NO_POPUP` | 未设置 | 设为任意非空值时，runner 在 macOS 下不再自动弹出 Terminal.app 窗口运行 `tmux attach`。供测试和后台跑批使用——窗口在 tmux session 结束后会留下空 attach 提示，污染桌面。 |
| `ROLL_LOOP_GC_RETENTION_DAYS` | `30` | 覆盖 `roll loop gc` 的保留天数。优先级高于 `.roll/local.yaml` 中的 `loop_gc.retention_days`。 |

`ROLL_CONFIG` 和 `ROLL_GLOBAL` 都派生自 `ROLL_HOME`，所以通常只需覆盖
`ROLL_HOME` 即可一并搬迁。

## 常见覆盖场景

把 roll 状态钉到项目本地目录（适合 CI、测试、隔离实验）：

```bash
export ROLL_HOME="$PWD/.roll-sandbox"
roll setup
roll loop now
```

不动 `~/.roll`，用另一套约定运行 roll：

```bash
ROLL_GLOBAL=/path/to/team-conventions roll init
```

用一次性配置文件验证改动：

```bash
ROLL_CONFIG=/tmp/test-config.yaml roll agent use kimi
```

## 验证

`roll status` 会打印解析后的路径，便于确认覆盖是否生效；
通过 `$roll-doctor` 技能可以诊断解析后的 `ROLL_HOME` 下的目录结构问题。

## Agent 安装

- `roll agent use openai` 实际调用 Codex CLI。安装方式：
  `npm install -g @openai/codex`
- `roll agent use gemini` 实际调用 Google Gemini CLI。安装方式：
  `npm install -g @antigravity/agy`
- 完整支持列表见 [ai-agents.md](ai-agents.md)。

## 相关文档

- [overview.md](overview.md) — 三层模型、BACKLOG 优先级
- [loop.md](loop.md) — `roll loop` 子命令
- [ai-agents.md](ai-agents.md) — 支持的 AI Agent
