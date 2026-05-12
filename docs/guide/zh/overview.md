# Roll — 概述

Roll 是一个自主交付系统，能把 BACKLOG 里的故事持续交付为已推送的代码。
工程实践（TCR、INVEST 故事、代码评审）被编码为可执行的技能（Skill）——
可靠到足以让 agent 无人值守地运行，严谨到足以交付生产代码。

## 三层自主模型

```
Human（人）  →  提需求、审 PR、执行 roll-release
Loop（循环） →  每小时执行 BACKLOG 故事（roll loop）
Dream（夜检）→  每晚扫描代码健康，生成 REFACTOR 条目（roll-.dream）
Peer（协商） →  每次高风险构建前跨 Agent 评审（roll peer）
```

- **人层**：你写 `## Ideas`，批准故事，运行 `scripts/release.sh`。
- **Loop 层**：`roll loop on` 安装 launchd 调度器。在活跃窗口内每小时触发一次，
  从 BACKLOG.md 摘取最高优先级的 `📋 Todo` 故事并通过 `$roll-build` 执行。
- **Dream 层**：凌晨 3 点定时扫描代码库，发现摩擦点，将 `REFACTOR-NNN` 条目
  追加到 BACKLOG.md，等 loop 下次调度执行。
- **Peer 层**：在执行高风险构建前，loop 调用 `roll peer` 向另一个 AI Agent
  （kimi、deepseek、codex 等）请求二次评审。

## 快速开始

```bash
# 安装 roll
npm install -g @seanyao/roll

# 在项目里初始化
cd my-project
roll setup
roll init

# 开启自主运行
roll loop on

# 实时查看进度
roll loop monitor
```

## BACKLOG 优先级顺序

Loop 按如下顺序选取故事：

1. `FIX-XXX` 缺陷（阻碍项优先）
2. `US-XXX` 用户故事
3. `REFACTOR-XXX` 技术债

标记了 `🚫 Hold` 或 `🔨 In Progress` 的故事会被跳过。
任何时候都可以直接运行 `$roll-build US-XXX` 绕过 loop 立即执行某个故事。

## 关键文件

| 文件 | 用途 |
|------|------|
| `BACKLOG.md` | 故事索引（Status 列驱动 loop 调度） |
| `docs/features/<feature>.md` | 每条故事的 AC、文件范围、依赖关系 |
| `~/.roll/config.yaml` | Agent 路由、活跃窗口、调度时间 |
| `~/.shared/roll/loop/state.yaml` | 当前 loop 运行状态 |
| `~/.shared/roll/loop/runs.jsonl` | 每次运行的历史记录 |

## 延伸阅读

- [loop.md](loop.md) — 调度、所有子命令、tmux 可见性
- [dream.md](dream.md) — 夜间代码健康巡检和 REFACTOR 生成
- [peer.md](peer.md) — 跨 Agent 评审协议
