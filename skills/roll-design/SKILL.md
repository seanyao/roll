---
name: roll-design
license: MIT
allowed-tools: "Read, Edit, Write, Glob, Grep, Bash(git:*), WebSearch, WebFetch, Skill"
description: Unified entry for discussion, design and planning. Explores options when uncertain, designs solutions with DDD modeling, splits into INVEST-compliant user stories, and writes to .roll/backlog.md. Use when user wants to discuss approaches, design solutions, plan features, or create stories.
---

# Design

> Follows the Architecture Constraints, Development Discipline, and Engineering Common Sense defined in the project AGENTS.md.

Discuss approaches, design architecture, plan requirements, and write to `.roll/backlog.md`. DDD modeling depth scales automatically with input scope.

## When to Use

- Requirements or approach are uncertain and multiple options need to be compared
- Requirements have not yet entered the backlog
- A solution needs to be designed before splitting into Stories
- An existing plan needs to be written into `.roll/backlog.md`

> **Doc-refresh discipline**: When splitting stories that change user-visible behavior, always append a closing "doc-refresh" story.
> **文档刷新纪律**：拆出的 story 只要改变了用户可见行为，最后必须追加一张"文档刷新"收尾 story。
> See [Doc Update Discipline](#doc-update-discipline) at the bottom of this file for the full rule.

## Use This Skill For

- Approach exploration and comparison (discuss phase)
- New project domain modeling (Event Storming → Context Map → Tactical Model)
- New requirement planning with domain context
- Solution design
- Splitting into Stories
- Creating US / FIX entries

## When Not to Use

- One-liner capture of ideas or bugs (use `$roll-idea`)
- Executing an already-split US-XXX (use `$roll-build`)
- Fixing a well-defined FIX-XXX (use `$roll-fix`)

## Quick Start

```bash
# New project from scratch → full DDD modeling
$roll-design "design an e-commerce order system from scratch"

# Approach is uncertain → discuss first, then plan
$roll-design "What approach should we use for search? Postgres FTS or Meilisearch?"

# Plan new requirement → domain slice + Stories → write to BACKLOG
$roll-design "user system design"

# Split Stories from an existing Plan
$roll-design --from-plan .roll/features/auth-plan.md

# Directly create a Story (auto-detected as User Story → Slice DDD)
$roll-design "user login feature"

# Non-interactive: read structured input file, skip Clarify/Discuss, write BACKLOG
$roll-design --from-file docs/requirements/auth-req.md

# Promote IDEA to Story: read BACKLOG IDEA-NNN, produce US-XXX, annotate IDEA
$roll-design --from-idea IDEA-009
```

## DDD Depth Scale

DDD modeling depth is determined automatically. It is not a switch — it is a dial.

```
输入范围              DDD 深度        产出物
─────────────────────────────────────────────────────────────
新项目 / greenfield   Full            Event Storming (对话引导)
                                      Context Map + UL 词汇表
                                      每个 Context 的 Tactical Model
                                      → .roll/domain/

User Story / 新特性   Slice           定位所属 Bounded Context
                                      关键 Aggregate + 触碰的 Entity/VO
                                      触发的 Domain Event + 跨域影响
                                      → 写入 US 的 Domain Model 段

Bug Fix               Tag             Context > Aggregate > Entity 定位
                                      → 写入 FIX 描述行
```

**深度自动判断逻辑**（在 Step 2 Analyze 阶段评估）：

```
Greenfield 信号（满足任意一条）:
  - 无 .roll/backlog.md / .roll/domain/ 目录
  - 输入含 "从零" / "新项目" / "建模" / "设计整个系统" 关键词
  - complexity = large AND 无已有 Bounded Context 文档

User Story 信号:
  - 输入是功能需求 / US-XXX 引用
  - complexity = medium or small AND 业务逻辑可见

Bug Fix 信号:
  - 输入是 FIX-XXX / 错误描述 / 明确的问题定位
  - 无需建模，只需定位上下文
```

## Workspace Configuration

Document structure (two-layer separation):

```
.roll/backlog.md                          # US index page (status + one-liner + link)
.roll/features/
  <feature>.md                      # US details (AC / Files / Dependencies)
  <feature>-plan.md                 # Design document (why / how)
.roll/domain/                        # DDD domain model (greenfield / cross-feature)
  context-map.md                    # Bounded Contexts + 关系图
  ubiquitous-language.md            # 统一语言词汇表
  <context>-model.md                # 每个 Context 的 Tactical Model
```

**Important rules:**
1. Plan files go in `.roll/features/<feature>-plan.md` (**no longer using** `docs/plans/`)
2. US details go in the corresponding `.roll/features/<feature>.md`
3. **FIX / IDEA detail files use ID-prefixed filenames**: `.roll/features/<epic>/FIX-097.md`, not `.roll/features/<epic>/some-descriptive-slug.md`. Reason: a single FIX is one card, not a long-lived feature; the ID is the most stable handle, descriptive slugs date quickly and break links. US can keep feature-slug naming (US lives inside a multi-Story feature file). Quick lookup: `ls .roll/features/<epic>/FIX-*.md` finds all bugs in that area without grepping content.
4. .roll/backlog.md only contains index rows (one row per US), **do not write** AC / Files / Notes
5. Domain model files go in `.roll/domain/` — create on first greenfield design, update incrementally
6. **Do not** write to `~/.kimi/` or any global config directory

**File path resolution order:**
1. Determine Feature ownership (based on the requirement domain: compiler / ingest / qa / ...)
2. Feature file: `.roll/features/<feature>.md` (create if it doesn't exist)
3. Plan file: `.roll/features/<feature>-plan.md` (create if it doesn't exist)
4. .roll/backlog.md index row goes under the corresponding Epic > Feature group

## Non-Interactive Mode

Activated by explicit flags or auto-detected high-confidence input. Skips Clarify and Discuss, writes stories directly to BACKLOG as `📋 Todo`, no confirm gate.

### `--from-file <path>`

```
Input: structured requirement file (plain text or markdown)

Expected file contents (minimum viable):
  - Description: what to build (1–3 sentences)
  - Expected AC: measurable outcomes (bullet list)
  - [Optional] Domain hint, priority, dependencies

Execution path:
  [Read file] → [Analyze] → [DDD Slice] → [Solution Design] → [Split Stories]
      → [Write BACKLOG 📋 Todo] → Done (no Clarify, no Discuss, no confirm gate)
```

Input file example (`docs/requirements/auth-req.md`):
```markdown
## Requirement: session timeout warning

Description: Show a countdown modal 60 seconds before session expires.
Users can click "Stay logged in" to extend, or let it expire naturally.

Expected AC:
- Modal appears at T-60s with countdown timer
- "Stay logged in" sends a keepalive and dismisses modal
- Expiry after countdown logs user out and redirects to /login
- Works across all authenticated pages
```

### `--from-idea IDEA-NNN`

```
Input: IDEA-NNN identifier from .roll/backlog.md

Execution path:
  [Read .roll/backlog.md IDEA-NNN row] → [Analyze] → [DDD Slice] → [Split Stories]
      → [Write BACKLOG 📋 Todo] → [Annotate IDEA row: → US-XXX] → Done

IDEA annotation: append `→ US-XXX` to the IDEA row's Description column.
Example: | IDEA-009 | ... | ✅ Done → US-AUTO-021 |
```

### High-Confidence Auto-Detection

When input is not a flag-based mode but already contains all three of: **clear verb**, **explicit scope**, and **verifiable acceptance signal**, skip Clarify automatically. At most retain Discuss (only if approach has genuine divergence).

High-confidence signals (all three must be present):
- Clear verb: add / remove / fix / rename / migrate / split / extract / support ...
- Explicit scope: named file, command, module, endpoint, or UI element
- Acceptance signal: "so that X", "when Y then Z", measurable outcome described

Examples:
```bash
# High confidence — skip Clarify:
$roll-design "add --dry-run flag to roll loop on that prints plist without installing"
$roll-design "rename cmd_status() to cmd_overview() in bin/roll and update all callers"

# Low confidence — enter Clarify:
$roll-design "improve the status command"
$roll-design "make loop better"
```

---

## Workflow

```
User Input
    │
    ├── --from-file <path>  ──→  [Read file] → Step 2 (Analyze) → Steps 3–5 → BACKLOG 📋 → Done
    ├── --from-idea IDEA-N  ──→  [Read BACKLOG IDEA] → Step 2 → Steps 3–5 → BACKLOG 📋 → Annotate IDEA → Done
    ├── high-confidence str ──→  Step 2 (Analyze) directly (skip Clarify, keep Discuss if divergence)
    │
    ▼
┌─────────────────────────────┐
│ 0. Clarify (when vague)     │  ← Automatically triggered when input is under-specified
│    - Summarize intent        │
│    - Assess complexity       │
│    - Ask 3–5 targeted Qs    │
│    - Wait for user reply     │
└─────────────┬───────────────┘
              │ Intent clear
              ▼
┌─────────────────────────────┐
│ 1. Discuss (when uncertain) │  ← Automatically triggered when approach is uncertain
│    - List 2-4 viable options │
│    - Each: approach + pros/cons │
│    - Comparison matrix       │
│    - Recommendation + rationale │
│    - Human makes final decision │
└─────────────┬───────────────┘
              │ Approach confirmed
              ▼
┌─────────────────────────────┐
│ [peer] Direction Review     │  ← if complexity=large or cross-context; 10s opt-out
│    Skill("roll-peer",       │
│      tag="architecture")    │
└─────────────┬───────────────┘
              │ AGREE / skipped
              ▼
┌─────────────────────────────┐
│ 2. Analyze + DDD Depth      │  ← Detect scope: Greenfield / Story / Fix
│    - Requirement analysis    │
│    - Feasibility assessment  │
│    - DDD depth determination │
└──────┬──────────────────────┘
       │
       ├── Greenfield ──→ ┌─────────────────────────────┐
       │                  │ 2a. Event Storming (对话引导) │
       │                  │  Big Picture:                │
       │                  │    - 发现 Domain Events       │
       │                  │    - 识别 Actors / Commands  │
       │                  │    - 标记 Hot Spots           │
       │                  │  Process Level:              │
       │                  │    - Command→Event→Policy 链 │
       │                  │    - 识别 Bounded Context 边界│
       │                  │  Design Level:               │
       │                  │    - Aggregate 候选           │
       │                  │    - Entity vs Value Object  │
       │                  └──────────────┬──────────────┘
       │                                 │
       │                  ┌──────────────▼──────────────┐
       │                  │ 2b. Strategic Design         │
       │                  │  - Bounded Contexts 定义     │
       │                  │  - Context Map (关系类型)    │
       │                  │  - Ubiquitous Language 词汇表│
       │                  │  → .roll/domain/context-map.md│
       │                  │  → .roll/domain/ubiquitous-   │
       │                  │      language.md             │
       │                  └──────────────┬──────────────┘
       │                                 │
       ├── User Story ──→ ┌──────────────▼──────────────┐
       │                  │ 2c. Domain Slice             │
       │                  │  - 定位所属 Bounded Context  │
       │                  │  - 识别关键 Aggregate        │
       │                  │  - 触碰的 Entity / VO        │
       │                  │  - 触发的 Domain Events      │
       │                  │  - 跨域影响（如有）          │
       │                  └──────────────┬──────────────┘
       │                                 │
       └── Bug Fix ─────→ ┌──────────────▼──────────────┐
                          │ 2d. Domain Tag               │
                          │  - Context > Aggregate >     │
                          │    Entity 定位               │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
              ┌─────────────────────────────────────────┐
              │ 3. Solution Design                       │
              │    - Architecture design                 │
              │    - Module decomposition                │
              │    - Dependency analysis                 │
              │    [Greenfield] Tactical Model per Context:
              │      - Aggregate Root + Entities + VOs  │
              │      - Invariants (业务不变式)           │
              │      - Domain Events (触发条件 + 消费方) │
              │      - Repository interfaces            │
              │      - Domain Services (跨 Aggregate)  │
              │    → .roll/features/<feature>-plan.md    │
              │    [Greenfield] → .roll/domain/<ctx>-    │
              │      model.md                           │
              └──────────────────┬──────────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────────┐
              │ [peer] Plan Review                       │  ← if complexity=large; 10s opt-out
              │    Skill("roll-peer", tag="architecture")│
              └──────────────────┬──────────────────────┘
                                 │ AGREE / skipped
                                 ▼
              ┌─────────────────────────────────────────┐
              │ 4. Split into Stories                    │
              │    - INVEST principles                   │
              │    - Bounded Context → US domain prefix  │
              │    - Priority ordering                   │
              │    - **强制检查**: 若本批次任一 US 改了    │
              │      用户可见行为（CLI 输出 / 命令参数 /  │
              │      状态语义 / 错误提示），必须在末尾追加 │
              │      一张 doc-refresh 收尾 story         │
              │      （详见 Doc Update Discipline 一节）│
              └──────────────────┬──────────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────────┐
              │ 5. Write to .roll/backlog.md                   │
              │    - Create US-XXX                       │
              │    - Define AC                           │
              │    - Link design documents               │
              └──────────────────┬──────────────────────┘
                                 │
                                 ▼
                       "Confirm and execute?"
                       │
                       ├── Yes ──→ $roll-build US-XXX
                       │
                       └── No  ──→ Story 已写入 BACKLOG 为 📋 Todo
                                   loop 下轮将自动执行
                                   （选 No 仅跳过立即执行）
```

**Gate 语义澄清**：选 `No` 不是放弃，story 已经入 BACKLOG，下轮 loop 会自动 pickup
（次日 / `roll loop now`）。若想完全搁置，请显式把状态改为 🚫 Hold。

---

## DDD Output Formats

### Event Storming — Big Picture (对话引导)

AI 扮演引导人，按顺序提问，不跳步骤：

```
Step 1 - 发现 Domain Events:
  "请描述这个系统里会发生的重要事情，用过去式动词短语
   （例如：订单已创建、支付已完成、库存已扣减）"

Step 2 - 识别触发者:
  "每个事件是谁/什么触发的？
   （用户操作 / 系统自动 / 定时任务 / 外部系统）"

Step 3 - 标记 Hot Spots:
  "哪些地方你还不确定？有哪些业务规则有争议？
   （标记为 ⚠️ Hot Spot，后续重点讨论）"
```

输出格式（Big Picture 阶段结果）：

```
Domain Events discovered:
  [OrderPlaced] ← Customer (user action)
  [PaymentCompleted] ← Payment Gateway (external)
  [InventoryReserved] ← System (automatic, after OrderPlaced)
  [OrderShipped] ← Warehouse Staff (user action)

Hot Spots ⚠️:
  - 支付失败后如何回滚库存预留？
  - 同一商品多仓库时库存扣减策略？
```

### Event Storming — Process Level

```
Step 4 - Command→Event 链:
  "把事件串成流程：什么命令触发了它？
   触发后系统自动做什么（Policy）？"

Step 5 - 识别 Bounded Context 边界:
  "哪些事件自然聚集在一起？
   哪些事件之间有明显的组织边界或团队边界？"
```

输出格式（Process Level 阶段结果）：

```
Flow: Order Lifecycle
  [PlaceOrder] ──→ (Order) ──→ [OrderPlaced]
                                    │ Policy: reserve inventory
                                    ▼
                              (Inventory) ──→ [InventoryReserved]
                                    │ Policy: request payment
                                    ▼
                              (Payment) ──→ [PaymentCompleted]

Candidate Bounded Contexts:
  - Order Context    (OrderPlaced, OrderShipped, OrderCancelled)
  - Inventory Context (InventoryReserved, InventoryReleased)
  - Payment Context  (PaymentCompleted, PaymentFailed)
```

### Strategic Design Output

写入 `.roll/domain/context-map.md`：

```markdown
## Bounded Contexts

| Context | 职责边界 | 核心概念 |
|---------|---------|---------|
| Order | 订单生命周期管理 | Order, OrderItem, Customer |
| Inventory | 库存预留与释放 | Stock, Reservation, Warehouse |
| Payment | 支付处理与退款 | Payment, Refund, Transaction |

## Context Map

Order ═══U/D═══→ Inventory   (Customer-Supplier: Order 下游消费库存事件)
Order ═══U/D═══→ Payment     (Customer-Supplier: Order 发起支付请求)
Payment ──ACL──→ Alipay      (Anti-Corruption Layer: 防腐层隔离第三方)
```

写入 `.roll/domain/ubiquitous-language.md`：

```markdown
| 术语 | 定义 | 所属 Context | 注意事项 |
|-----|------|-------------|---------|
| Order | 买家提交的购买意向，包含商品列表和配送信息 | Order | 不等于"交易"，交易在 Payment Context |
| Reservation | 为订单锁定的库存数量，有时效 | Inventory | 区别于 Allocation（正式分配） |
```

Context Map 关系类型说明：

```
═══U/D═══→  Customer-Supplier (上下游依赖)
───ACL───→  Anti-Corruption Layer (防腐层)
═══PL════   Partnership (平等协作)
───SK───    Shared Kernel (共享内核)
───CF───→  Conformist (顺从者)
───OHS──→  Open Host Service (开放主机)
```

### Tactical Model Output

写入 `.roll/domain/<context>-model.md`：

```markdown
## Tactical Model: Order Context

### Aggregates

**Order** (Aggregate Root)
  Entities:   OrderItem
  Value Objects: Address, Money, OrderStatus
  Invariants:
    - 订单金额 = sum(OrderItem.price × quantity)
    - 已支付订单不可修改商品列表
    - OrderItem 数量必须 > 0

### Domain Events

| Event | 触发条件 | 消费方 | Payload |
|-------|---------|-------|---------|
| OrderPlaced | Order.place() 成功 | Inventory Context | orderId, items, customerId |
| OrderCancelled | Order.cancel() | Inventory Context, Payment Context | orderId, reason |

### Repository Interfaces

IOrderRepository:
  - findById(orderId): Order
  - save(order): void
  - findByCustomer(customerId, page): Order[]

### Domain Services

OrderPricingService:
  - 职责: 跨 PriceRule Aggregate 计算最终价格（含优惠券、会员折扣）
  - 原因: 定价逻辑跨越多个 Aggregate，不归属任何单一 Root
```

### Domain Slice Output（User Story 级别）

插入 US 的 Domain Model 段（见 Story Format）：

```markdown
**Domain Model:**
- Context: Order
- Aggregate: Order (Root) owns [OrderItem, Address]
- Entities touched: OrderItem (新增/修改)
- Events raised: [OrderItemUpdated] → Inventory Context
- Cross-context: Inventory Context 需同步更新预留数量
```

### Domain Tag Output（Bug Fix 级别）

写入 FIX 描述的第一行：

```
Domain: Order Context > Order Aggregate > OrderItem Entity
```

### AGENTS.md Where to Look — 指针维护

After completing any Domain Slice (User Story level), check if the project's `AGENTS.md` has a `## Where to Look` section with a `.roll/domain/` pointer. If missing, append one line:

```markdown
- **Domain model**: `.roll/domain/context-map.md` — Bounded Contexts and relationships
```

Rules:
- Idempotent: only append if the pointer line is not already present
- Do not modify any other content in AGENTS.md
- Skip silently if `.roll/domain/` does not yet exist for this project

---

## Clarify Phase

**Skip conditions** — silently skip Clarify when any of these hold:
- Input uses `--from-file` or `--from-idea` flag (non-interactive mode)
- Input is high-confidence (clear verb + explicit scope + acceptance signal — see Non-Interactive Mode)

**Trigger conditions** — automatically enters if none of the skip conditions hold AND any of these are met:
- Input is a single vague sentence without clear scope
- Missing clear boundaries (what / who / when / where)
- Contains ambiguous terms like "优化一下", "改一下", "加个东西", "做个设计"
- Could be interpreted in multiple ways

**Pre-Clarify: three-step product localization (always run first, silently)**

Before listing questions, internally determine:
1. **产品端 (product end)**: web / mobile / API / CLI / other — which surface does this touch?
2. **角色 (role)**: who initiates this action? (end user / admin / system / external)
3. **业务域 (domain)**: which business domain does this belong to?

Already-localized dimensions become context prefix in the output, not open questions.

**Output format:**

```
🎯 Clarified Intent: {1-2 sentences}
🗺  Context: {product end} · {role} · {domain}   ← omit if all three are unknown

📏 Complexity: {small|medium|large}

❓ Open Questions:
1. {question 1}
2. {question 2}
3. {question 3}
...

➡️  Please answer the questions above and I'll proceed to design.
```

**Rules:**
- Do **not** start designing until the user replies.
- Never announce "I'm using clarify." Just do it naturally.
- If the input is already clear enough, skip silently and proceed to Discuss or Analyze.

---

## Discuss Phase

**Trigger conditions** — automatically enters if any of these are met:
- User is explicitly asking "how to choose" or "what approach to use"
- More than 2 viable technical paths exist
- Requirement involves an unfamiliar tech stack or new domain

### How to Conduct the Discussion

Discuss is **multi-turn by default**. The goal is to reach clarity together, not to produce a complete comparison matrix in one shot.

**Step 1 — Understand before proposing**

Before listing options, make sure the core problem is clear. If context is thin, ask 1–2 focused questions first:

```
Before I lay out the options — can you tell me [specific constraint / scale / existing system boundary]?
```

Only skip this if the context is already rich enough to reason from.

**Step 2 — Offer an opinionated starting point, not a menu**

Don't dump 4 options at once. Lead with a concrete recommendation and the key tradeoff:

```
My read: go with X. The main tradeoff is [Y vs Z]. Want me to walk through why, or should I compare against [alternative] first?
```

Then wait. Let the user redirect.

**Step 3 — Follow the thread**

If the user wants to dig into a specific option or challenge an assumption, stay on that thread. Don't pivot back to the full comparison until the current thread is resolved.

**Step 4 — Surface hidden assumptions explicitly**

When a direction starts to crystallize, name the assumptions holding it up:

```
This only holds if [assumption]. Is that true for your situation?
```

**Step 5 — Name convergence before triggering the gate**

When the discussion reaches a clear conclusion, summarize it explicitly before asking to proceed:

```
Looks like we've landed on: [decision]. The key reasons: [1–2 points].
```

Then trigger the gate.

**Gate rule** — after convergence is named, always end with this explicit prompt and **wait for user reply before proceeding**:

```
➡️  Continue to solution design, or keep exploring?
```

Do **not** infer "approach confirmed" from the user's reaction to the comparison. Only proceed to Step 2 (Analyze) when the user explicitly says to continue (e.g., "yes", "proceed", "go ahead", "design it").

**Can stop at any time** — if after discussion the user says "let's not do it" or "let me think about it", there's no need to continue to the planning phase.

---

## Operation Sequence for Creating a New Story

```bash
# 1. Determine Feature ownership (e.g., compiler / ingest / qa)
FEATURE="compiler"

# 2. Write Plan document (if there is a solution design)
PLAN_FILE=".roll/features/${FEATURE}-plan.md"

# 3. Append US section in .roll/features/<feature>.md (with full AC)
FEATURE_FILE=".roll/features/${FEATURE}.md"

# 4. Append index row under the corresponding Epic > Feature group in .roll/backlog.md
# | [US-XXX](.roll/features/compiler.md#us-xxx) | One-line description | 📋 Todo |

# 5. [Greenfield only] Write domain model files
DOMAIN_DIR=".roll/domain/"
# .roll/domain/context-map.md
# .roll/domain/ubiquitous-language.md
# .roll/domain/<context>-model.md
```

---

## Story Format

**.roll/backlog.md index row (only write this one line):**

```markdown
| [US-{DOMAIN}-{N}](.roll/features/<feature>.md#us-{domain}-{n}) | {one-line description} | 📋 Todo |
```

`{one-line description}` 写法：用户能读懂的一句话，说清楚"能做什么"或"解决了什么麻烦"。不写实现细节、文件路径、函数名。细节和 AC 写在 `.roll/features/` 里。写好了可以直接当 CHANGELOG 条目用。

Note: `{DOMAIN}` maps to the Bounded Context name identified in DDD analysis.

**US section in .roll/features/\<feature\>.md (full details):**

```markdown
<a id="us-{domain}-{n}"></a>
## US-{DOMAIN}-{N} {Story Title} 📋

**Created**: {YYYY-MM-DD}
**Plan**: [{feature}-plan.md]({feature}-plan.md)  ← if a design document exists

- As a {role}
- I want {action}
- So that {benefit}

**Domain Model:**
- Context: {Bounded Context name}
- Aggregate: {Root} owns [{entities}]
- Events raised: [{EventName}] → {consumer context}
- Cross-context: {if touches another context, otherwise omit}

**AC:**
- [ ] {measurable criteria 1}
- [ ] {measurable criteria 2}
- [ ] {measurable criteria 3}

**Files:**
- `{file1}`
- `{file2}`

**Dependencies:**
- Depends on: {prerequisite US-XXX}
- Depended on by: {subsequent US-XXX}

**Data Flow (if applicable):**
- Producer: {which module writes data}
- Consumer: {which module reads data}
- Integration test: `tests/integration/{flow}.test.ts`
```

### Closing Doc-Refresh Story Template — Phase N.M 收尾文档

When any preceding US in the batch changes user-visible behavior, append this template story at the end of the batch. Wire it as `depends-on:` against every preceding user-facing US so it runs last.

```markdown
<a id="us-{domain}-{n}"></a>
## US-{DOMAIN}-{N} Phase {N.M} 用户文档刷新（中英双轨） 📋

**Created**: {YYYY-MM-DD}

- As a roll user reading the docs
- I want the user-facing documentation to match the new behavior shipped in this Phase
- So that the next person reading the guide / README / `--help` does not hit a stale version

**AC:**
- [ ] Update each affected doc file listed below; **English line and Chinese line on separate lines**, never inline
- [ ] `roll <cmd> --help` output reflects new flags / commands / status semantics (paste verified output)
- [ ] README index links to any new guide pages
- [ ] Error-message changes are mirrored in troubleshooting / FAQ sections
- [ ] Verified: no doc page still describes the pre-Phase behavior

**Files:**
- `guide/en/{topic}.md`
- `guide/zh/{topic}.md`
- `README.md` (index entry)
- `{any other user-facing doc touched by the Phase}`

**Dependencies:**
- Depends on: {every preceding user-facing US in this batch}
- Worked example: 参考 `features/authoring/slide-deck-generator.md` 的 US-DECK-015 ——
  roll slides Phase 1.5 把 6 张 user-visible US 末尾合并成一张 doc-refresh story 的范例。
```

---

## INVEST Principles

Each story must be:
- **Independent**: Can be implemented independently
- **Negotiable**: Scope is negotiable
- **Valuable**: Provides value to the user
- **Estimable**: Effort can be estimated
- **Small**: Small enough for fast delivery
- **Testable**: Can be tested and verified

## Backlog Structure

```markdown
# Project Backlog

## Epic Name
### Feature Name
| Story | Description | Status |
|-------|-------------|--------|
| [US-XXX](.roll/features/<feature>.md#us-xxx) | One-line description | 📋 Todo |
| [US-YYY](.roll/features/<feature>.md#us-yyy) | One-line description | ✅ Done |
```

**Note**: .roll/backlog.md only contains index rows; full AC / Files / Dependencies go in `.roll/features/<feature>.md`.

---

## Integration

### With roll-build

```
$roll-design "login feature" → Create US-AUTH-001
User: "Execute US-AUTH-001"
    ↓
$roll-build US-AUTH-001 → TCR → CI/CD → Deploy
```

### With roll-fix

```
$roll-debug discovers issue → Suggest creating FIX
$roll-design "fix login API 404" → Create FIX-AUTH-001  ← auto-detected as Bug Fix
$roll-fix FIX-AUTH-001 → Quick fix
```

### With roll-peer

Two checkpoints, both with 10s opt-out:

```
1. After Discuss — Direction Review
   Approach confirmed → [peer, tag=architecture] → challenge the direction before DDD
   Trigger: complexity=large OR requirement touches multiple Bounded Contexts

2. After Solution Design — Plan Review
   Plan written → [peer, tag=architecture] → full plan review before story split
   Trigger: complexity=large (greenfield always qualifies)
```

On AGREE or user skip → continue to the next step normally.
On REFINE/OBJECT → incorporate feedback, regenerate the relevant output, re-trigger peer.
On ESCALATE → present both proposals to user for final call.

---

## Project Context Rule

Before creating any file or directory:

1. **Read existing project structure** — check for `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, existing `src/`, `api/`, `cmd/` directories
2. **Check existing domain model** — if `.roll/domain/` exists, read `context-map.md` before adding new Bounded Contexts
3. **Infer conventions from evidence** — don't assume a project type; observe what already exists
4. **Follow what already exists** — introduce new patterns only when the current structure has no precedent

> `roll init` no longer asks for project type. Skills are responsible for reading context and acting accordingly.

---

<a id="doc-update-discipline"></a>
## Doc Update Discipline

When `$roll-design` splits a feature into stories, **the closing tasking step is
always a doc-refresh story whenever any preceding US changes user-visible
behavior**. This is mandatory, not optional — without it, code ships and the
docs silently drift to the previous version, and only the next user to read the
guide notices.

**When a separate doc-refresh story IS required (任一为真即触发)：**
- 任一 US 改了 **CLI 输出**（新增/修改输出行、表头、颜色、emoji 语义）
- 任一 US 改了 **命令参数**（新增/重命名 flag、改变 default、收紧/放宽校验）
- 任一 US 改了 **状态语义**（backlog 状态、cycle 状态机、退出码含义）
- 任一 US 改了 **错误提示** / 用户可读日志文案
- 任一 US 新增/删除/重命名一个用户能直接调用的命令

**When it can be skipped (纯内部变更，用户感知不到)：**
- 纯内部重构（内部函数改名、模块边界调整、测试沙箱化）
- CI / hooks / 工具链修复
- 安全 / 隔离基础设施（沙箱配置、权限矩阵内部调整）
- 测试基础设施 / fixture 数据更新

**Checklist for the doc-refresh story (中英双语必需)：**
- [ ] `guide/en/<topic>.md` — English guide updated
- [ ] `guide/zh/<topic>.md` — Chinese guide updated
- [ ] `README.md` index links to any new doc page
- [ ] `--help` output snapshot matches new flags / commands / status semantics
- [ ] Error-message strings reflected in troubleshooting / FAQ
- [ ] **Bilingual rule**: English and Chinese on **separate lines**, never inline
      （遵循 project CLAUDE.md 中 Bilingual Output Convention）

**How to wire the doc-refresh story:**
1. Place it **last** in the batch
2. `depends-on:` lists **every** preceding user-facing US in the batch
3. Title 用 "Phase N.M 用户文档刷新（中英双轨）" 模板（见 [Story Format](#story-format) 中的模板）
4. Cite a worked example in its Dependencies note — current best reference is
   `features/authoring/slide-deck-generator.md` US-DECK-015 (roll slides Phase 1.5)

> Self-validation: this very skill was strengthened via US-SKILL-009; the
> roll slides Phase 1.5 tasking (US-DECK-015) is the canonical worked example
> of the discipline in action.
