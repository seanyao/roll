# Roll — 概述

Roll 是一个自主交付系统。把目标写进 `.roll/backlog.md`，让 Roll 去执行。

## 快速开始

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash

cd my-project
roll setup && roll init

roll next           # 接续 design/apply/repair/migrate/loop/status
roll loop on        # AI 按可配置频次执行 BACKLOG
roll loop status    # 查看调度状态和最近 cycle
roll loop watch     # 可选：只读实时旁观当前 cycle
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
- `roll loop watch` — 默认只读实时状态；排查事件用 `--events`，审计/底层排障才用 `--raw-events` `[highlight]`
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
- `roll design` / `$roll-design` — DDD 驱动规划：澄清 → 设计 → 拆分为 INVEST 故事。`roll design` 从命令行在你的 AI agent 里拉起设计技能。`[core]`
- `$roll-build` — TCR 故事执行 → worktree → PR → 自动合入 `[core]`
- `$roll-fix` — 快速路径 Bug 修复，同样的 CI 门禁，更轻的流程

### 可观测性

- `roll status` — 判定优先的真相摘要（LOOP · CYCLE · RELEASE · STORY，含 attest 验收覆盖率），其后是约定/AI 客户端同步健康 `[core]`
- 交付档案 — web 控制台：判定条、loop 心跳、三聚合、六态 Story 光谱，全部读自同一份真相快照
- `roll loop runs` — 每轮 TerminalOutcome 历史，含 TCR 次数和耗时
- `roll loop alert` — 查看、确认、清除 loop 告警
- `roll dossier` — 交付档案：已发布、进行中、队列、真相漂移、发布就绪，全部读自同一份真相账本 `[highlight]`

### 交付档案 —— web 控制台

`roll index` 渲染 `index.html`，即交付档案。上面每个数字都读自同一份真相快照，
因此 web 面与 CLI 打印的聚合一致（`roll cast` ≡ Casting 网格、`roll doctor skills`
≡ Skills 页、`roll release consistency` ≡ 七维面板、`roll status` ≡ Story 光谱）。
一处计算，两副面孔。

控制台的信息架构：

- **深色顶栏 + 绿点项目切换器** —— 当前项目带一个绿色状态点；切换器列出
  `~/.roll/projects.json` 里的每个项目（与 `roll ls` 打印的同一份注册表），可在各项目
  的控制台之间跳转。
- **EN / 中 语言切换** —— 单语呈现；切换会把整个控制台在中英之间整体翻面。
- **项目页签** —— Now · Backlog · Loop · Release · Casting · Charter。Now 是默认
  落地视图：实时 cycle、loop 心跳、运行进程、下批候选、需要你处理的行，以及带判定、
  聚合块和六态 Story 光谱的真相汇总。
- **机器全局面包屑（`MACHINE › …`）** —— Agents · Skills · Tools · Conventions ·
  About。这些页面描述的是机器而非单个项目：本机安装的 agents、治理本机每个项目的
  `skills/<name>/SKILL.md` 契约、**Tools** 页（`tools.html`）上的内置工具清单与每个
  工具的默认护栏（超时 / 沙箱 / 重试 / 每周期上限）、以及同步进各 AI 客户端的约定。
- **Charter** —— 一个 markdown 浏览器，内联渲染项目的 charter 文档、语言指南
  （`guide/en` ↔ `guide/zh`）与史诗规划。
- **Casting** —— 谁演什么：四个复杂度槽位（easy / default / hard / fallback）加上
  场景角色（peer · PR review · spar · onboard）。未配置的槽位显式打出破折号，绝不臆测。

三态交付阶梯 —— **claimed → merged → attested** —— 取代二值的「完成」标志。
backlog 行写了 Done 只是 `claimed`；交付 PR 合入 `main` 后变 `merged`，验收证据
（报告 · AC 映射 · 视觉证据）齐备后变 `attested`。**一个故事当且仅当既已合并又已验收
时才算完成**（`done ≡ 已合并 ∧ 已验收`）；不到这一步只会渲染成漂移或未知，绝不悄悄显示绿色。

### 按需技能

- `$roll-debug` — 挂载诊断探针，追踪根因，如果可溯源则自动修复
- `$roll-doc-audit` — 核对文档/网站/help 与实现；索引缺口并起草缺失文档
- `$roll-doctor` — 诊断开发工具链：node、npm、git、AI 工具
- `$roll-notes` — 以叙述形式记录一个开发时刻

### 多 Agent 协作

- 故障转移路由 — 主 agent 宕机 → 自动切换备用 `[highlight]`
- `$roll-peer` — 多轮协商；`roll peer` 记录一次性结构化 review facts `[core]`
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
| 受治理的工具注册表与策略 | [tools.md](tools.md) |
| 夜间代码健康巡检与 REFACTOR 生成 | [dream.md](dream.md) |
| 跨 Agent 评审协议 | [peer.md](peer.md) |
| 完整技能目录 | [skills.md](skills.md) |
| 接入模式（seed / graft / replant） | [patterns/](patterns/README.md) |
| 给已有项目接入 Roll | [legacy-onboarding.md](legacy-onboarding.md) |
| 从 2.0 之前版本升级 | [migration-2.0.md](migration-2.0.md) |
| 常见场景与故障排查 | [faq.md](faq.md) |
| 环境变量配置 | [configuration.md](configuration.md) |
