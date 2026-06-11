# Roll — 概述

Roll 是一个自主交付系统。把目标写进 `.roll/backlog.md`，让 Roll 去执行。

## 快速开始

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash

cd my-project
roll setup && roll init

roll loop on        # AI 按可配置频次执行 BACKLOG
roll loop status    # 查看调度状态和最近 cycle
tmux attach -t roll-loop-<project-slug>   # 可选：实时旁观当前 cycle
```

## 工作原理

Roll 运行在三个自主层上：

- **Loop** — 按可配置频次从 BACKLOG 摘取最高优先级故事，在隔离的 worktree 里通过 `$roll-build` 执行。CI 通过后才会落到 `main`。
- **Dream** — 凌晨 3 点扫描代码库，发现死代码、文档缺口和架构漂移，将 `REFACTOR-NNN` 条目排队交给 loop 领取。
- **Peer** — 高风险构建前，第二个 AI agent 评审方案或 diff，同意后才继续执行。

你负责提需求、审 PR、执行发布。中间的一切交给 Roll。

## 功能一览

### 自主执行

- `roll loop on` — AI 从 BACKLOG 领取故事，按可配置频次在隔离 worktree 里执行 `[core]`
- `roll loop status` — 查看调度、最近 cycle、队列、告警和成本 `[core]`
- `tmux attach -t roll-loop-<project-slug>` — 附加到实时 tmux 会话，观看 AI 工作过程 `[highlight]`
- `roll loop pause / resume` — 手动编码时暂停，完成后让 AI 继续

### 质量门禁

- Peer 评审 — 第二个 AI agent 在高风险构建前挑战方案或 diff `[core]` `[highlight]`
- 自检 — 每次微提交后自动做 post-commit 检查
- 验收检查 — 每次构建后对照故事定义逐条核实 AC
- CI 门禁 — loop 等待 CI 绿；CI 红则停止循环并写入告警 `[core]`
- TCR 纪律 — 测试不过不提交；空 diff 提交自动回滚 `[core]`

### 夜间巡检

- 代码健康扫描 — 检测死代码、架构漂移、过度工程候选项 `[highlight]`
- 文档覆盖率 — 标记缺失指南、过时文档、未记录的 ENV 变量
- REFACTOR 队列 — 将 REFACTOR-NNN 条目写入 BACKLOG，次日早晨由 loop 领取

### 故事生命周期

- `$roll-idea` — 一行捕获：即时生成 FIX 或 IDEA 条目 `[core]`
- `$roll-design` — DDD 驱动规划：澄清 → 设计 → 拆分为 INVEST 故事 `[core]`
- `$roll-build` — TCR 故事执行 → worktree → PR → 自动合入 `[core]`
- `$roll-fix` — 快速路径 Bug 修复，同样的 CI 门禁，更轻的流程

### 可观测性

- `roll status` — 项目健康：backlog 队列、loop 状态、CI、发布就绪判断 `[core]`
- 交付档案 — 带真相条和 Story / Cycle / Release 真相板
- `roll loop runs` — 每轮 TerminalOutcome 历史，含 TCR 次数和耗时
- `roll loop alert` — 查看、确认、清除 loop 告警
- `roll brief` — 每日摘要：已发布、进行中、下一优先级 `[highlight]`

### 按需技能

- `$roll-debug` — 挂载诊断探针，追踪根因，如果可溯源则自动修复
- `$roll-doc` — 扫描任意项目的文档缺口，生成缺失文档
- `$roll-sentinel` — 将生产环境与 BACKLOG 验收标准进行点检
- `$roll-doctor` — 诊断开发工具链：node、npm、git、AI 工具
- `$roll-notes` — 以叙述形式记录一个开发时刻

### 多 Agent 协作

- 故障转移路由 — 主 agent 宕机 → 自动切换备用 `[highlight]`
- `roll peer` — 结构化协商：提案 → 挑战 → 精炼，最多 3 轮 `[core]`
- PR 收件箱 — 外部 PR 先经 AI 评审再合入；过时 PR 自动 rebase `[new]`
- `roll review-pr` — 对任意 PR 按需发起 AI 评审，可指定 agent `[new]`

## 项目结构

Roll 2.0 让项目根目录保持干净，所有 Roll 管理的产物都收进 `.roll/`：

```
my-project/
├── AGENTS.md            # 工程约束（根目录 — Agent 第一读它）
├── README.md            # 产品门面
├── src/  tests/         # 业务代码
└── .roll/               # Roll 接触的一切
    ├── backlog.md       # Story / Fix / Refactor 索引
    ├── features/        # 每个 Story 的 AC + plan 文档
    ├── domain/          # DDD 模型、context map
    ├── briefs/  dream/  # 自主层产出
    └── decisions/       # ADR
```

从 2.0 之前的版本升级？看 [migration-2.0.md](migration-2.0.md) ——
`npx @seanyao/roll@2 migrate` 一次性把旧版 `BACKLOG.md`、`docs/features/`、
`docs/domain/` 迁到新布局。

## 选择接入模式

Roll 支持三种接入模式，按项目起点选择 —— 决策树见
[patterns/](patterns/README.md)：

- **Seed（播种）** —— 空目录 + 产品愿景。从 day 1 就是 Roll 原生形态。
- **Graft（嫁接）** —— 已有代码、零侵入。`$roll-onboard` 从现有项目反推
  生成 `.roll/`。参见 [legacy-onboarding.md](legacy-onboarding.md)。
- **Replant（翻种）** —— 历史包袱重。先反推规格，再按新规格重建。

## 指南目录

| 主题 | 文档 |
|------|------|
| 第一次跑通项目 | [getting-started.md](getting-started.md) |
| 调度、子命令、tmux 可见性 | [loop.md](loop.md) |
| 夜间代码健康巡检与 REFACTOR 生成 | [dream.md](dream.md) |
| 跨 Agent 评审协议 | [peer.md](peer.md) |
| 完整技能目录 | [skills.md](skills.md) |
| 接入模式（seed / graft / replant） | [patterns/](patterns/README.md) |
| 给已有项目接入 Roll | [legacy-onboarding.md](legacy-onboarding.md) |
| 从 2.0 之前版本升级 | [migration-2.0.md](migration-2.0.md) |
| 常见场景与故障排查 | [faq.md](faq.md) |
| 环境变量配置 | [configuration.md](configuration.md) |
