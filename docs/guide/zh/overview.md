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

## 功能一览

### 自主执行

- 自主执行 / `roll loop on` — AI 从 BACKLOG 领取故事，每小时在隔离 worktree 里执行 `[core]`
- 自主执行 / `roll loop monitor` — 实时看板：loop / dream / brief 服务状态 `[core]`
- 自主执行 / `roll loop attach` — 附加到实时 tmux 会话，观看 AI 工作过程 `[highlight]`
- 自主执行 / `roll loop pause / resume` — 手动编码时暂停，完成后让 AI 继续

### 质量门禁

- 质量门禁 / Peer 评审 — 第二个 AI agent 在高风险构建前挑战方案或 diff `[core]` `[highlight]`
- 质量门禁 / 自检 — 每次微提交后自动做 post-commit 检查
- 质量门禁 / 验收检查 — 每次构建后对照故事定义逐条核实 AC
- 质量门禁 / CI 门禁 — loop 等待 CI 绿；CI 红则停止循环并写入告警 `[core]`
- 质量门禁 / TCR 纪律 — 测试不过不提交；空 diff 提交自动回滚 `[core]`

### 夜间巡检

- 夜检 / 代码健康扫描 — 检测死代码、架构漂移、过度工程候选项 `[highlight]`
- 夜检 / 文档覆盖率 — 标记缺失指南、过时文档、未记录的 ENV 变量
- 夜检 / REFACTOR 队列 — 将 REFACTOR-NNN 条目写入 BACKLOG，次日早晨由 loop 领取

### 故事生命周期

- 故事生命周期 / `$roll-idea` — 一行捕获：即时生成 FIX 或 IDEA 条目 `[core]`
- 故事生命周期 / `$roll-design` — DDD 驱动规划：澄清 → 设计 → 拆分为 INVEST 故事 `[core]`
- 故事生命周期 / `$roll-build` — TCR 故事执行 → worktree → PR → 自动合入 `[core]`
- 故事生命周期 / `$roll-fix` — 快速路径 Bug 修复，同样的 CI 门禁，更轻的流程

### 可观测性

- 可观测性 / `roll status` — 项目健康：backlog 队列、loop 状态、CI、发布就绪判断 `[core]`
- 可观测性 / `roll loop runs` — 每轮历史，含结果、TCR 次数、耗时
- 可观测性 / `roll alert` — 查看、确认、清除 loop 告警
- 可观测性 / `roll brief` — 每日摘要：已发布、进行中、下一优先级 `[highlight]`

### 按需技能

- 技能 / `$roll-debug` — 挂载诊断探针，追踪根因，如果可溯源则自动修复
- 技能 / `$roll-doc` — 扫描任意项目的文档缺口，生成缺失文档
- 技能 / `$roll-sentinel` — 将生产环境与 BACKLOG 验收标准进行点检
- 技能 / `$roll-doctor` — 诊断开发工具链：node、npm、git、AI 工具
- 技能 / `$roll-notes` — 以叙述形式记录一个开发时刻

### 多 Agent 协作

- 多 Agent / 故障转移路由 — 主 agent 宕机 → 自动切换备用 `[highlight]`
- 多 Agent / `roll peer` — 结构化协商：提案 → 挑战 → 精炼，最多 3 轮 `[core]`
- 多 Agent / PR 收件箱 — 外部 PR 先经 AI 评审再合入；过时 PR 自动 rebase `[new]`
- 多 Agent / `roll review-pr` — 对任意 PR 按需发起 AI 评审，可指定 agent `[new]`

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
- [configuration.md](configuration.md) — `ROLL_HOME` / `ROLL_CONFIG` / `ROLL_GLOBAL` 覆盖
