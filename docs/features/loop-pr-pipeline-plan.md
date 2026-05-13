# Plan: Loop × PR 自治交付管线

> 不是一个 feature 文档，而是 **roadmap + 设计原则**。把 FIX-031 / US-AUTO-033..037 串成一条「故事入 BACKLOG → loop 在 worktree 跑 → 推 PR → AI 评审 + CI 双门 → auto-merge → 下一轮 cron 先消化 PR 再领新货」的完整自治闭环。

## 1. 设计原则

### 1.1 自我修改悖论 — 故事拆分标准

```
loop 跑在 runner.sh ──→ 故事修改 runner.sh ──→ 新 runner.sh 仅在【下一轮】生效
                                              ↓
                                              下一轮 = 第一次生产运行
                                              ↓
                                              生产 = 验证 ⚠️
```

按以下二分把任何 loop-infrastructure 类故事归类：

| 维度 | Loop-safe（loop 可自跑） | Loop-unsafe（必须人工 `$roll-build`） |
|---|---|---|
| 影响层 | 数据面：helpers / tests / docs / skills 内容 | **编排面**：runner.sh / launchd plist / cron / `roll loop *` 命令 / state.yaml schema / LOCK 协议 |
| 性质 | 纯加法（add） | 替换正在跑的逻辑（swap-while-flying） |
| 验证手段 | bats 单测、文件存在性、内容比对 | 重启 daemon / 等下一轮 cron / 观察并发 |
| 失败回退 | revert，零副作用 | 未来 loop 全坏，可能静默降级到下下轮才暴露 |
| BACKLOG 标签 | 无（默认） | `manual-only:true` |

**US-AUTO-032 拆分实例**：原整块故事按这条线拆为 US-AUTO-036（helpers，loop-safe）+ US-AUTO-037（runner 接入，manual-only）。

**灰色地带 caveat**（kimi peer review 2026-05-13 提出）：该拆分标准是 **heuristic 而非 formal guarantee**。`bin/roll` 添加的 helpers 技术上仍在 runner 的执行上下文里（runner.sh 会 source `bin/roll`），SKILL.md 的内容变化也会被 inner script 喂给 claude 改变行为。把这类故事划为 loop-safe 的依据是：(a) 零行 runner.sh 改动（git diff 强约束）；(b) 独立 bats 单测覆盖；(c) 函数语义纯（不引入新状态机）。本地验证不能 100% 排除上下文 leak，但远比改 orchestration layer 安全。

### 1.2 依赖管理 — 用 BACKLOG 内联标签，不发明新机制

沿用 [US-AUTO-028](../../BACKLOG.md) 已在用的格式，在每行 BACKLOG 描述末尾加 `` `depends-on:US-XXX[,US-YYY,...]` `` 内联标签 + `` `manual-only:true` `` 标识需人工执行的故事。spec 文档的 `**Dependencies:**` 段保留可读性叙述。

**FIX-032 是 Phase 1 硬前提**（kimi peer review 2026-05-13 指出）——parser 不落地，depends-on 标签形同虚设，loop 可能在依赖未满足时领走 story。所以 FIX-032 必须先于 US-AUTO-033 进入 loop 队列。

### 1.3 PR-first vs PR-avoid — 把 PR 当工作单元

```
旧思路（PR-avoid）：loop 撞到开放 PR → 退让 → 跳过相关故事 → 等人处理 PR
新思路（PR-first）：loop 起跑先扫开放 PR → 推进一格（review/approve/rebase）→ 再领新货
```

PR 不是障碍物，是**已经流入系统的工作**。让 loop 先消化队列再开新单，符合 autonomous-evolution 的整体模型。

## 2. 终态架构

```
[cron 触发]
   │
   ├─ Step A: PR Inbox（US-AUTO-034）
   │     │
   │     ├─ 扫 gh pr list --state open
   │     ├─ loop 自有分支 (loop/<US>) ──→ 已 auto-merge，跳过让 GitHub 平台合
   │     ├─ 外部/人工 PR        ──→ 调 AI review (US-AUTO-035)
   │     │     ├─ approve         ──→ gh pr review --approve → auto-merge 触发
   │     │     ├─ request-changes ──→ 评论 + ALERT
   │     │     └─ uncertain       ──→ ALERT escalate
   │     └─ stale PR             ──→ rebase + 重跑 CI；失败 ALERT
   │
   ├─ Step B: PR Inbox 处理完毕
   │
   ├─ Step C: 扫 BACKLOG（现有逻辑）
   │     │
   │     ├─ 跳过 manual-only:true 的故事
   │     ├─ 跳过未满足 depends-on 的故事（依赖到位再领）
   │     └─ 选下一条 📋 Todo
   │           │
   │           ▼
   ├─ Step D: 起 worktree 跑 story（US-AUTO-036/037）
   │     │
   │     ├─ git fetch origin main
   │     ├─ git worktree add ... -b loop/<US> origin/main
   │     ├─ cd worktree && 执行 skill (TCR 微提交)
   │     └─ 完成
   │
   └─ Step E: 推 PR + auto-merge（US-AUTO-033）
         │
         ├─ git push origin loop/<US>
         ├─ gh pr create ...
         └─ gh pr merge --auto --squash
              ↓
         【GitHub 平台行为：等所有 required gate】
              ├─ ci.yml test 绿
              └─ claude-code-review approve（US-AUTO-035，路径 C）
                   ↓ 全部满足
              squash & merge ──→ main
                   ↓
              loop 删 worktree + 删分支
```

## 3. 故事 × 责任矩阵

| ID | 角色 | Loop 可执行？ | 依赖 |
|---|---|---|---|
| FIX-031 | LOCK 并发修复 | ✅ | 无 |
| FIX-032 | depends-on / manual-only 标签 parser | ✅ | 无（Phase 2 硬前提） |
| US-AUTO-036 | worktree helpers + 单测 | ✅ | 无 |
| US-AUTO-037 | helpers 接入 runner | ❌ manual-only | US-AUTO-036 |
| US-AUTO-033 | loop 建 PR + auto-merge | ✅ | US-AUTO-037, FIX-032 |
| US-AUTO-035 | claude-code-review 加 approve | ✅ | US-AUTO-033 (value) |
| US-AUTO-034 | PR Inbox 先消化再领（带 rebase 熔断 + human-review guard） | ✅ | US-AUTO-033, US-AUTO-035 |

## 4. 依赖图

```
       FIX-031 ──(独立，随时可做)
       FIX-032 ──(Phase 2 硬前提：parser 不到位 depends-on 形同虚设)
                       │
                       ▼ (parser 上线后 depends-on 生效)
                                                              ┌──→ US-AUTO-035
       US-AUTO-036 ──→ US-AUTO-037 ──→ US-AUTO-033 ───────────┤        │
        (helpers)     (runner 接入)    (建 PR + auto-merge)    └────────┤
                       人工接管         路径 A（仅 CI 绿合）           │
                                                                       ▼
                                                                US-AUTO-034
                                                          (PR-first inbox
                                                           + rebase 熔断
                                                           + human-review guard)
                                                                       │
                                                                       ▼
                                                            repo: required_review=1
                                                            切到路径 C
                                                            (CI 绿 + AI approve 双门)
```

## 5. Phase 排程

```
┌────────────────────────────────────────────────────┐
│ Phase 1 — 基础设施（loop 自治前提）                  │
├────────────────────────────────────────────────────┤
│ FIX-031        LOCK 并发修复            loop 跑     │
│ FIX-032        depends-on parser        loop 跑     │  ← Phase 2 硬前提
│ US-AUTO-036    worktree helpers         loop 跑     │
│ US-AUTO-037    helpers 接入 runner      人工 build  │  ← 自我修改悖论
└────────────────────┬───────────────────────────────┘
                     │ 至此 loop 跑独立 worktree
                     ▼
┌────────────────────────────────────────────────────┐
│ Phase 2 — PR 自治闭环（路径 A：仅 CI 绿即合）        │
├────────────────────────────────────────────────────┤
│ US-AUTO-033    loop 建 PR + auto-merge  loop 跑     │
└────────────────────┬───────────────────────────────┘
                     │ 至此 loop 推 PR，CI 绿自动合
                     ▼
┌────────────────────────────────────────────────────┐
│ Phase 3 — AI 审查门（升级到路径 C）                  │
├────────────────────────────────────────────────────┤
│ US-AUTO-035    claude-code-review 加   loop 跑     │
│                approve/request-changes              │
│ + 切 repo required_pull_request_reviews=1 (一行 API)│
└────────────────────┬───────────────────────────────┘
                     │ 至此 CI 绿 + AI 通过 双门
                     ▼
┌────────────────────────────────────────────────────┐
│ Phase 4 — PR Inbox（消化队列）                       │
├────────────────────────────────────────────────────┤
│ US-AUTO-034    loop 起跑先消化 PR       loop 跑     │
└────────────────────────────────────────────────────┘
```

## 6. 路径渐进策略 A → C

> kimi peer review (2026-05-13) 提醒：渐进策略不是「Path A 比终态弱」，而是 **每一步都比现状更安全**。当前状态是 `roll-build` 直接 `git push origin main`（零 gate），Path A 引入 PR 审计链 + CI 强制门，**严格严于现状**。Path C 在此基础上再加 AI gate。


```
[路径 A — 仅 CI 绿]                                    [路径 C — CI 绿 + AI 评审]
gh pr merge --auto --squash                            gh pr merge --auto --squash
        ↓                                                       ↓
等 ci.yml test 绿                                      等 ci.yml test 绿
        ↓                                                       ↓
自动合                                                 + 等 claude-code-review approve
                                                                ↓
                                                       双门通过 → 自动合
```

切换动作（Phase 3 落地时同步操作）：

```bash
gh api -X PATCH repos/seanyao/Roll/branches/main/protection \
  -f required_pull_request_reviews.required_approving_review_count=1
```

Escape hatch：紧急 hotfix 在 PR body 加 `[skip-ai-review]` tag → action 直接 approve。

## 7. 未涉及的未来方向

- **路径 D — 跨 agent peer review**：claude 写的代码请 kimi/codex/deepseek action 审，规避同源 bias。本管线未实现，预留扩展点
- **跨 story 并发**：当前仍单 LOCK（per-slug）。未来若引入并发，LOCK 协议需重设，且 worktree 命名空间已具备隔离能力
- **Worktree GC**：失败 worktree 不会自动清，靠 ALERT 提示人。未来由 `roll-doctor` 增加陈旧扫描

## 8. 决策记录

| 决策 | 日期 | 理由 |
|---|---|---|
| US-AUTO-037 选方案 B（claude 主导 selection） | 2026-05-13 | 跟 loop 自治哲学一致；selection 单一来源 (SKILL.md)；diff 小一半。代价是 branch 名用 cycle-id 而非 US-id，但 spec literal 的 `loop/<US>` 只是 cosmetic（per-cycle 隔离用 cycle-id 一样达成），跨 story 并发本就在 Non-goals。 |
| US-AUTO-032 拆 036+037 | 2026-05-13 | loop 自己 ALERT 提示「自我修改悖论」，按拆分标准切开 |
| US-AUTO-034 reframe 为 PR-first | 2026-05-13 | 把 PR 视为工作单元而非障碍，跟 autonomous-evolution 模型对齐 |
| FIX-030 作废，并入 US-AUTO-037 | 2026-05-13 | worktree 基于 origin/main 后，local main 落后/dirty 检查变得多余 |
| 开 `allow_auto_merge=true` | 2026-05-13 | US-AUTO-033 的硬前提，先开不影响现状 |
| 路径选 C（CI + AI 双门） | 2026-05-13 | 单 CI gate 漏覆盖（架构错/scope 蔓延），AI 评审作为第二道门 |
| 加 FIX-032 进 Phase 1（depends-on parser） | 2026-05-13 | kimi peer review REFINE：parser 不先落，Phase 2 的 depends-on 约束完全无强制力，loop 可能在依赖未满足时领走 story |
| US-AUTO-034 加 rebase 熔断 + human-review guard | 2026-05-13 | kimi peer review REFINE：原 AC 未覆盖 workflow-broken 导致的无限 rebase 循环，以及人审已介入时 AI 仍会发起评审的覆盖风险 |
| 拆分标准明示为 heuristic + 灰色地带 caveat | 2026-05-13 | kimi peer review REFINE：原文未承认 helpers 仍在 runner 上下文里，需明示 loop-safe 的依据（零 runner.sh 改动 + 单测 + 函数语义纯）|
