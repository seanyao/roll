# 系统设计

## 产品定位

roll 是 AI coding agent 的**外层控制系统**（agent harness / reliability layer）。它不进入 agent 内部（不管理 token 窗口、不压缩对话、不干预单次推理），而是在外部建立一个闭环：设定目标 → 调度执行 → 感知结果 → 修正方向。

用户通过 CLI 或 Web 控制台与 roll 交互。安装方式：`npm install -g @seanyao/roll`。

## 为什么是分层闭环

一个可靠的控制器，必须是被控系统的一个**连贯模型**（[specs/theory-foundation](specs/theory-foundation.md)）。当同一个能力域被摊在多种异构载体上、靠文本缝合（stdout 解析、现生成脚本、散落的状态文件）时，协调开销本身就在吃掉控制带宽——**散，是不稳定与低效的根因**：那类"引号地狱 / 解析漂移 / 状态不一致"的故障，长的正是载体之间的缝。

所以 roll 是一台**分层的 TypeScript 控制器**：每个能力域一个家，层与层用类型化契约相连，反馈闭环作脊柱。缝消失，长在缝上的那类故障也就失去土壤。

## 设计五原则

1. **每个能力域一个家。** 把摊在四种载体上的同一个域（Orchestration / Observability / Evals / Guardrails / Context Engineering / Tool Use / Sandboxing），收敛成一个连贯的 owner/包。这是 roll 缺的那层"系统设计"。
2. **反馈闭环是脊柱，层是它的器官。** 别把能力域做成并列模块；按"结构核心 + 控制平面"接成一个闭环：核心作动（编排/执行/工具/上下文）→ 控制平面传感/评分/限幅（可观测/Evals/Guardrails）→ 反哺下一轮。
3. **TS 类型 = 层与层之间的契约。** 层与层用类型化接口相连，而不是 stdout 解析 / 现生成脚本——缝消失，长在缝上的那类故障失去土壤。
4. **守住黑盒边界（外层 harness）。** roll 不打开黑盒：token 级压缩、工具 schema 强制、单次 ReAct 委派给内层 agent。不必建模被控对象内部，靠反馈就能控制（[specs/theory-foundation](specs/theory-foundation.md)）。
5. **反馈要有 Goodhart 护栏。** 闭环一旦把度量当目标就会被钻空子。所以 Evals 信号**不自动激活**、只生成"待人确认"候选；人在环上（human-on-the-loop）作监督限幅；retry 设上限并转 replan（anti-windup）；不对噪声反复 replan（deadband）。这是一条显性的设计纪律。

## 系统架构

```
spec         共享类型与事件合同（零依赖）

core         领域逻辑（纯函数，不碰 I/O，通过接口注入外部依赖）
             BacklogStore · StoryPicker · AgentRouter
             PRLifecycle · TCRPipeline · ReconcileEngine
             CostTracker · PolicyEngine · EventBus

infra        I/O 适配层
             Config · Git · GitHub · launchd/cron · Tmux · ProcessManager

daemon       事件观察者（只读，fs.watch → WebSocket 广播，挂了不影响 loop）

cli          命令入口（薄壳，解析参数 → 调 core → 格式化输出）

web          控制台（React，WebSocket 订阅 daemon）
```

依赖单向向上。下层不感知上层。

**技术选择**：TypeScript（类型安全）、vitest（自带进程沙箱）、commander + chalk（CLI）、simple-git + octokit（Git/GitHub）、handlebars（模板，替代 heredoc）、proper-fs-lock（替代手写锁）、React + shadcn/ui（前端）。

### 能力域归宿（每域一个家）

每个能力域在 6 包里的家：

| 能力域 | 家 |
|---|---|
| **Orchestration** 编排 | `core`（StoryPicker / TCRPipeline / ReconcileEngine / CycleOrchestrator）+ `infra`（launchd/cron 调度） |
| **Sandboxing** 执行隔离 | `infra`（Git worktree / ProcessManager / Tmux） |
| **Tool Use** 工具/多 agent | `core`（AgentRouter / AgentRegistry / CostTracker 的 usage 解析）+ `infra`（spawn / GitHub） |
| **Context Engineering** 上下文 | skill 桥接（独立仓）+ `.roll/` 文档纪律（是契约） |
| **Observability** 可观测 | `spec`（事件 schema）+ `core`（EventBus 写端）+ `daemon`（只读广播） |
| **Evals** 验证/评分 | `core`（Evals 六维 + 测试质量门） |
| **Guardrails** 治理 | `core`（PolicyEngine + Budget guardrails） |

> skills 不进 TS：仍是 markdown + shell，经桥接 spawn（它们是"灵魂/契约"，归 `roll-skills` 独立仓）。roll 收敛的是**控制器代码**，不是 skill 内容。

## 领域模型

系统分为 8 个 Bounded Context。每个上下文内部一致，上下文之间通过共享 artifact 和事件流协作——没有中央调度器。

### BC1 · Backlog

管理项目意图。一个故事一棵层级树：Epic → Feature → Story。

**核心概念**：
- 故事有唯一 ID，处于四种状态之一：待办 / 进行中 / 完成 / 暂缓
- 故事之间有依赖边（`depends-on`）
- 状态翻转必须使用精确整行匹配（杜绝子串误伤）

**写规则**：多写并发使用乐观锁——读出全文哈希，修改后写前校验哈希未变，冲突即重试。写操作原子完成。

### BC2 · Loop 编排

这是系统的引擎。一个 Loop 是一个自治进程，按定时器唤醒，执行一个 Cycle。

**Cycle 生命周期**：选故事 → 路由 agent → 创建隔离工作区 → agent 执行（TCR 循环）→ 送交 PR → 等合并 → 对账 → 收尾。

**关键约束**：
- 一 Cycle 只做一个 Story。前一个未交付，不拿下一个。
- 进程可能被 SIGKILL。下次唤醒时，通过锁龄、心跳、PID 判断孤儿态，安全接管或重做。
- 心跳每 60 秒写入一次。超时无心跳 → 判定死亡并落终态。
- 退出时无条件写入终态。这是硬约束——trap 兜底。
- 连续失败达阈值 → 暂停并告警，等用户决策。不自动换 agent。不无限重试。

**Loop 类型**：
| 类型 | 职责 |
|------|------|
| main | 消费待办，执行完整的 pick→TCR→PR→对账 周期 |
| pr | 监控 open loop PR：CI 挂了自愈，绿了合并 |
| ci | 监控 CI 状态 |
| alert | 消费 ALERT 文件，推送到用户 |

### BC3 · Agent 路由

管理可用的 AI agent 及其路由规则。

**路由规则**：根据任务的层级（epic/feature/story）和类型（US/FIX/REFACTOR）映射到 `(agent, model)`。同一输入永远返回同一路由——结果可审计、可复现。

**探活**：spawn agent 前进行秒级探测并缓存结果。不可用时依次尝试 fallback 槽。全部不可用 → 暂停并告警。

**反规则**：不因历史表现自动调整路由偏好。不做跨 agent 自动切换（失败不偷偷换人重试）。

### BC4 · 交付

每次交付是一个 Pull Request。一个 Story 至多同时有一个 open PR。

**生命周期**：开 PR → CI 通过 → 合并入 main → 删除分支。

**交付判定**：合并入 main 才算交付。PR 已开、CI 已绿、agent 声称完成都不算——事后对账，只认 main 上真实的 merge commit。

### BC5 · 演化

追踪一个 Story 的完整生长过程。每一次 TCR 微提交、每一次回退都可追溯。支持对比不同 agent 对同一 Story 的实现，支持回退到任意历史节点。

### BC6 · 策略

解析并执行 `.roll/policy.yaml` 中的人类意图。

**策略类型**：
- 自动合并：满足条件自动 merge PR
- 审查标记：特定文件或层级标记需人审查
- 安全限幅：连续失败 N 次 → 暂停并告警
- 路由规则：覆盖默认 agent-模型映射
- 网络首检：任何需要网络的命令（`loop go/run`、agent 拉起、showcase、release 开 PR、update）把连通性（含代理）作为第一道检查。不通时跑配置的恢复钩子 `loop_safety.proxy_enable_cmd` 再复检：通了继续，仍不通就立刻停手并给出可操作的中英文原因——绝不带病前进、绝不空转、绝不静默降级。该钩子是用户自填的命令（roll 不内置任何代理工具）；未配置即停手并告知。
- Warm session 复用：`loop_safety.session_reuse: true` 只表达复用意图；必须同时设置 `loop_safety.resume_scope: same-story` 才会在同一 story 重试时复用 codex session。缺省、非法值或未设置 `resume_scope` 都按 `off` 处理，跨卡复用保持禁用。

策略是规则源——它不直接执行动作，而是被其他上下文读取并遵循。

### BC7 · 可观测

不可变事件流是唯一的真相源。所有状态都从事件重建，无独立缓存。

**三类持久化文件**：
| 文件 | 内容 |
|------|------|
| `events.ndjson` | 全量事件（每行一个 JSON，原子追加） |
| `runs.jsonl` | 运行摘要（按 story+cycle_id 去重） |
| `heartbeat` | 活性心跳（idle 也写） |

**事件类型**：`cycle:start/phase/tcr/end`、`warm-session:capture/resume-selected/resume-skipped`、`pr:open/merge`、`route:resolve`、`loop:heartbeat/fire/paused`、`policy:safety_pause`、`alert`。

**daemon**：独立进程，fs.watch 监控事件文件，通过 WebSocket 广播。它是只读观察者——挂了不影响任何 loop。loop 只写文件，不依赖 daemon。

**Delivery Dossier**：页面是 `TruthSnapshot` 的纯投影；页面渲染路径不得绕过 snapshot 直接调用面板 collector 或直读文件，新增数据面必须先进入 `collectDossierState`。

### BC8 · 成本

归集每个 Cycle 的实际消耗并设闸。

**记录内容**：`(agent, model, 输入 token, 输出 token, 预估成本, 回退次数, 含回退的有效成本)`。

**Budget guardrails**：项目/全局设日和周上限。逼近上限 → 自动降级到便宜模型或暂停并通知。便宜模型回退率高导致总成本反超 → 建议升级。

### 上下文协作

```
人（写故事 / 定策略）
    │                          ┌──────────────┐
    ▼                          │ BC6 策略      │
┌──────────┐   Backlog         │ 规则          │
│ BC1      │◄──────────────────│               │
│ 意图管理  │                    └──┬───┬───────┘
└────┬─────┘                      │   │
     │ Todo                       ▼   ▼
     ▼                      ┌──────────────────┐
┌──────────┐  Route 请求     │ BC2 编排          │
│ BC3 路由  │◄───────────────│ pick→TCR→PR→对账 │──cycle:*/heartbeat──┐
└──────────┘──route:resolve─►│                  │                     │
                             └──┬───┬───────────┘                     │
                                │   │ git/PR                          ▼
                          cost  │   ▼                    ┌──────────────────┐
                                ▼  ┌──────────────────┐  │ BC4 交付          │
                           ┌──────────┐               │  │ PR → CI → merge  │
                           │ BC8 成本  │               │  └──────┬───────────┘
                           │ 记录 + 闸 │               │         │ merged
                           └──────────┘               │         ▼
                                                      │     main (真相)
                                                      │         │
  全部事件 append ────────────────────────────────────────────► ┌──────────────────┐
                                                                │ BC7 可观测        │
  ALERT ← loop 写 ← alert loop 推 → 人                           │ 事件流 (唯一源)   │
                                                                │ → BC5 + UI       │
                                                                └──────────────────┘
```

**协作模式**：策略被下游遵从（Conformist）、Backlog 和 git/PR 是共享真相（Shared Kernel）、路由结果写事件（Customer/Supplier）、对账层过滤假交付（Anti-Corruption）、事件追加（Published Language）。loops coordinate via shared artifacts——多 loop 独立、event-driven，互不直接调用。

## 行为合同

以下 12 条不变量定义了系统的可靠性边界。每条必须可测试（与 [specs/harness-principles](specs/harness-principles.md) 的 C1–C12 一一对应，那里有每条的 FIX 证据）。

| # | 不变量 |
|---|--------|
| I1 | 在跑 Cycle 每 ≤60s 写心跳。超 watchdog 阈值必回收并落终态。进程活性 ⟂ 业务健康。 |
| I2 | 任意时刻进程被 SIGKILL，下次重入检测孤儿态并安全接管。不依赖优雅退出。 |
| I3 | 同一 Story 至多一个 open PR。开 PR 前先查去重。 |
| I4 | Backlog 是愿望，main 是真相。每 Cycle 末对账——标了完成但未合并的自动退回。退出码 0 ≠ 已交付，CI 绿 ≠ 已交付。 |
| I5 | 一个坏 Story 不冻结其他工作。连败 N 次 → 永久暂缓。不靠手动干预无限重试。 |
| I6 | 连续失败 → 暂停 + 告警 + 通知，人决策。不自动跨 agent fallback。 |
| I7 | 路径即身份。所有运行态数据放在 `<project>/.roll/loop/`。不同项目并行互不污染，无共享可变状态。 |
| I8 | 状态从不可变事件流重建，无独立缓存。追加原子（tmp→rename）。退出无条件写终态。 |
| I9 | 多写并发用乐观锁。标记 Story 精确匹配，不用子串。 |
| I10 | 按可预测规则路由（任务层级/类型）。spawn 前秒级探活。同输入路由恒定。 |
| I11 | 每 Cycle 记录 `(agent, model, token, cost, 回退次数, 有效成本)`。逼近预算上限 → 降级或暂停并通知。有效成本含回退。 |
| I12 | 一 Cycle 一个 Story，全新上下文，TCR 每步 green-or-revert。0 个 TCR 提交 → 判定失败并告警。 |

## 事实来源(US-TRUTH 系列)

读侧三件套(dashboard / dossier / status)不再各自解析 backlog/events/runs:

- **权威矩阵** `packages/spec/src/types/truth.ts`(`TRUTH_ANCHORS`):每个持久事实字段声明唯一权威源、唯一写者、派生视图、冲突仲裁与 unknown 判据。跨仓仲裁:`github_pr_merge > product_main > roll_meta`。
- **终态事件** `cycle:terminal`(schema v1,`TERMINAL_SCHEMA_EPOCH_SEC` 起强制):每字段要么有完整值,要么带枚举化缺失原因——静默 0/"—" 在结构上不可能。
- **选择器** `packages/core/src/truth/selectors.ts`:`deriveStoryTruth / deriveCycleTruth / deriveEvidenceTruth`,纯函数、闭合 reason code;输出 truth/warn/fail/unknown/grandfathered。
- **唯一读侧适配器** `packages/cli/src/lib/truth-adapter.ts`:dashboard 的周期分类、dossier 的 delivered 判定全部经它走选择器;**新增消费者必须走这里,再写一个本地解析就是本 epic 关掉的回归**。unknown 一律渲染为 `?`,绝不静默显示成功。
- **三聚合投影**:Story 判断 backlog 声明与 `main`/验收证据是否一致;Cycle 只认 TerminalOutcome 终态事实;Release 汇总发版闸 verdict 与有效 waiver。README / guide / site 只描述这些目标态语义。
- **claim vs truth**:backlog 的 `✅ Done` 是声明,不是事实源;`main` 合并、证据报告、终态事件、发版闸事件才是事实锚点。所有 UI 投影必须把声明和真相分开呈现。
- **truth board**:`roll index` 首页渲染 Story / Cycle / Release tiles 和真相条;未知事实显示 `?`,已知为零才显示 `0`。premature Done 会被标成 drift/fail,不会被当作已交付。
- **影子审计**:只读漂移扫描作为 `roll release` 闸的内部模块运行,报告落 `.roll/reports/consistency/`。
- **发版闸**:`roll release` 是唯一发版命令,事务内置一致性闸;任一维 fail 拦截发版,没有豁免路径——修掉漂移才能发。历史 release:waiver 事件仅作存档,不再有写入者。一致性闸跑在**开 PR / 合并之前**(发布分支上 bump+changelog 已提交、未合并),漂移在落 `main` 前就被拦,绝不留"已合并但没打 tag"的半成品。`main` 受 PR 保护,发版给自己也开 PR,再用 GitHub 原生 auto-merge(`gh pr merge --auto --squash`)自驱合并:不依赖 `com.roll.pr.<slug>` 看护 lane,进程中断也由 GitHub 完成合并;等待期逐轮打印进度,CI 不调度时推空提交 nudge;仓库未开 "Allow auto-merge" 则诚实报错而非静默挂死。
- **变更点护栏** `packages/spec/src/types/truth-registry.ts`(`TRUTH_FIELD_REGISTRY`):落盘且被第二处读取的字段必须登记(绑锚点、记写者、derived-cache 必声明 rebuild);未登记字段 CI 红并指路登记——历史 v2 字段 grandfather 列单。局部变量不登记。

### 结构化交付真相 (`DeliveryRecord` / `deliveries.jsonl`)

Backlog 状态格（`✅ Done` / `🔨 In Progress` 等）是**给人看的派生显示**——机器**绝不** parse 它当真相。机器管理的交付生命周期真相是结构化 `DeliveryRecord` 投影，存储在 `.roll/loop/deliveries.jsonl`（可重建 JSONL 缓存）。

**`DeliveryRecord`**（`packages/spec/src/types/delivery.ts`）：
- `storyId` / `cycleId` — 唯一定位一次交付
- `lifecycleState` — 机器派生的生命周期状态（见下一节）
- `prNumber` / `prUrl` / `mergedAt` / `mergeCommit` — PR 事实（`FactOr<T>`，缺失带枚举化原因，非静默零）
- `recordedAt` — 记录写入时间（epoch ms）

**事实来源**：
- `runs.jsonl` — cycle 意图、发布尝试、PR 字段、终态 outcome。
- first-parent `main`/`origin/main` git merge log — `done` 的权威信号；story-id 可出现在 merge subject 或 body。
- `deliveries.jsonl` — 从 runs + git 重建出的缓存，不是独立真相源；删掉后 `ensureDeliveriesFresh()` 会重建。
- `backlog.md` — 人可读声明与派生显示，不能作为机器交付真相。

**写入/重建规则**：Cycle 发 PR 时把 PR 字段写入 run 事实；交付投影由 `ensureDeliveriesFresh()` 幂等重建并覆盖 `deliveries.jsonl`，同一 story 的记录按投影规则 last-wins/merge-wins。PR 合并后的 `done` 以主干 merge 为准，而不是以 agent 自述或 backlog 翻牌为准。

**读取规则**：所有消费者（picker / reconcile / dossier / watch）**一律**走 `queryStoryDelivery()`，不读 markdown 状态——见 [唯一查询入口](#唯一查询入口-querystorydelivery)。

### 生命周期与裁定正交

两个维度各自独立——绝不混：

| 维度 | 语义 | 值空间 | 来源 |
|------|------|--------|------|
| **LifecycleState**（生命周期） | 卡**在哪**（管道位置） | `todo` / `building` / `in_flight` / `ci_red` / `blocked` / `on_hold` / `done` / `failed` / `abandoned` | 机器从 `TerminalOutcome` + PR 状态**派生**（`lifecycleFromFacts()`），不手设 |
| **TruthState**（裁定） | claim 是否**对**（校验结果） | `truth` / `warn` / `fail` / `unknown` / `grandfathered` | 选择器 `deriveStoryTruth`/`deriveCycleTruth` 从权威锚点仲裁 |

一张卡可以同时处于 `in_flight`（生命周期：PR 已开）和 `warn`（裁定：backlog 行仍标记 `📋 Todo`，声明滞后）——两个字段独立承载，不互斥、不塌缩。`ci_red` 是 `in_flight` 的 PR 级子状态（CI 挂了但卡仍在飞——修→重推→还 `in_flight`）。

### 唯一查询入口 (`queryStoryDelivery`)

**`queryStoryDelivery(storyId, deliveries) → StoryDeliveryTruth`**（`packages/core/src/truth/query.ts`）是交付真相的**唯一确定性查询函数**。纯函数、零 I/O、零 markdown parse——给定 story ID 和所有 `DeliveryRecord`，返回一个序列化 verdict。

**消费者契约（硬约束）**：
- **picker**（选卡）：跳过 `lifecycleState ∈ {in_flight, ci_red, done, blocked, on_hold}` 的卡
- **reconcile**（对账）：比对 `StoryDeliveryTruth.delivered` 与 backlog 声明
- **dossier**（档案）：`lifecycleState` + `deliveringCycles` 渲染交付阶段
- **watch / dashboard**（监控）：`TruthState` + 派生 backlog 状态格

**新增消费者必须走 `queryStoryDelivery`**——再写一个本地 markdown 解析、backlog 正则匹配、或 `runs.jsonl` 裸读，就是本 epic 关掉的回归。

**`deriveBacklogStatus(truth) → string`**：从 `StoryDeliveryTruth` 派生 backlog 显示字符串（如 `🔨 In Progress · PR#878`、`✅ Done · merged abc1234`）。backlog 状态格从此是**纯派生视图**——人可读但机器不认。`roll truth query <storyId>` CLI 命令直接调用 `queryStoryDelivery`，输出结构化 verdict。

### 存储裁定：不上 SQLite 当源

真实发生的 3-agent 会审（codex + kimi + pi，2026-06-20）一致否决 SQLite 作权威真相源。理由：

1. **毁 git-native** — SQLite 二进制不可 diff、不可 PR 评审、不可 `git revert` 单行回滚（I8）。
2. **毁 worktree 隔离** — Cycle worktree 各自操作同一个 SQLite 文件 → 需要 WAL 模式 + 文件锁 + 额外并发协议（I7）。
3. **毁可重建性** — 从事件流重建 SQLite 须维护 schema 迁移链；JSONL 按行追加，重建 = `cat events → filter → append`（I8）。
4. **过度工程** — "原子记全 卡↔PR↔🔨" justify 的是**事务性写入边界**（单 writer 一条复合 record 一次原子 append），不必是 DB。单行 JSON 远小于 `PIPE_BUF`（POSIX 保证原子性），一个 `O_APPEND write()` 就够了。

**当前方案**：`deliveries.jsonl` — append-only JSONL，复用已有原子写。SQLite **仅可作未来可重建的派生查询缓存**（每日从事件流重建），永不做真相源。

### 消费者契约总结

```
consumer         input                     output / 行为
────────         ─────                     ─────────────
picker           queryStoryDelivery()      skip if in_flight/ci_red/done/blocked/on_hold
reconcile        queryStoryDelivery()      delivered? vs backlog claim → drift verdict
dossier          StoryDeliveryTruth        lifecycle + deliveringCycles → phase UI
watch/dashboard  StoryDeliveryTruth        TruthState + derived backlog status → display
release gate     queryStoryDelivery()      all stories delivered? → gate pass/fail
shadow audit     queryStoryDelivery()      claim vs truth drift → .roll/reports/consistency/
```

`roll release consistency` 的 `truth-live` 维度是该契约的 CI/发版闸：它先运行 `ensureDeliveriesFresh()`，再用 `queryStoryDelivery()` 断言发布增量里的故事确实由结构化投影证明为 `done`，并校验 Done 行上的 PR ref 与投影一致。
