# Documentation

> Epic: 建立双语分层文档体系。用 DDD 领域边界组织工程文档，用 guide/ 层面向用户，
> EN 为 AI agent 和海外用户的正本，ZH 为华语用户的导出层。
> Dream 自动巡检文档覆盖度，loop 自动补写缺口，brief 透出健康状态。

---

<a id="us-doc-001"></a>
## US-DOC-001 建立 docs/guide/en/ + 反向补写 loop/dream/peer 英文用户指南 ✅

**Created**: 2026-05-12
**Completed**: 2026-05-12

- As a developer or international user
- I want clear English documentation for loop, dream, and peer
- So that I understand the value, when to use each, and all available commands

**AC:**
- [x] `docs/guide/en/overview.md` — What is roll, the three-layer autonomous model (human / loop / dream+peer), quick orientation
- [x] `docs/guide/en/loop.md` — Value prop, how it works (tmux+launchd), active window, LOCK, state machine, all `roll loop` subcommands with examples
- [x] `docs/guide/en/dream.md` — What dream does nightly, REFACTOR item generation, output files, how to read dream logs
- [x] `docs/guide/en/peer.md` — Cross-agent review protocol, AGREE/REFINE/OBJECT/ESCALATE states, capability map, when it auto-triggers, how to invoke manually
- [x] `docs/guide/en/` directory created, all four files committed

**Files:**
- `docs/guide/en/overview.md` (new)
- `docs/guide/en/loop.md` (new)
- `docs/guide/en/dream.md` (new)
- `docs/guide/en/peer.md` (new)
- `tests/unit/roll_doc_guide_en.bats` (new, 16 tests)

**Dependencies:**
- Depended on by: US-DOC-002, US-DOC-004, US-DOC-005

---

<a id="us-doc-002"></a>
## US-DOC-002 建立 docs/guide/zh/ + 中文版 loop/dream/peer 用户指南 ✅

**Created**: 2026-05-12
**Completed**: 2026-05-12

- As a Chinese-speaking user
- I want native Chinese documentation for loop, dream, and peer
- So that I can understand the full capability without reading English

**AC:**
- [x] `docs/guide/zh/overview.md` — 中文版系统概述，三层自主模型说明
- [x] `docs/guide/zh/loop.md` — 中文版 loop 指南：价值点、工作原理、活跃窗口、LOCK、状态机、所有子命令示例
- [x] `docs/guide/zh/dream.md` — 中文版 dream 指南：夜间巡检、REFACTOR 条目生成、日志读取
- [x] `docs/guide/zh/peer.md` — 中文版 peer 指南：跨 agent 协商协议、三态说明、触发条件、手动调用
- [x] ZH 内容语义与 EN 正本一致，不独立发散

**Files:**
- `docs/guide/zh/overview.md` (new)
- `docs/guide/zh/loop.md` (new)
- `docs/guide/zh/dream.md` (new)
- `docs/guide/zh/peer.md` (new)
- `tests/unit/roll_doc_guide_zh.bats` (new, 15 tests)

**Dependencies:**
- Depends on: US-DOC-001 (EN must exist first as source of truth)
- Depended on by: US-DOC-004, US-DOC-005

---

<a id="us-doc-003"></a>
## US-DOC-003 建立 docs/domain/ + DDD context-map + autonomous-operation 领域模型 ✅

**Completed**: 2026-05-11
**Created**: 2026-05-12

- As an engineer or AI agent reading the codebase
- I want a domain model that maps Roll's bounded contexts and their relationships
- So that I understand architectural boundaries before making changes

**AC:**
- [x] `docs/domain/context-map.md` — 5 个 Bounded Context（Convention Management / Skill Delivery / Autonomous Operation / Observability / Distribution）定义 + 关系图（U/D / ACL / PL 标注）
- [x] `docs/domain/autonomous-operation.md` — Loop/Dream/Peer 的 Aggregate 模型、统一语言词汇表、Domain Events、跨 context 影响
- [x] 两个文件英文撰写，内容从代码库反向提取（bin/roll + SKILL.md）

**Files:**
- `docs/domain/context-map.md` (new)
- `docs/domain/autonomous-operation.md` (new)
- `tests/unit/roll_doc_domain.bats` (new, 16 tests)

**Dependencies:**
- Independent (can run in parallel with US-DOC-001)
- Depended on by: US-DOC-005

---

<a id="us-doc-004"></a>
## US-DOC-004 迁移现有散落文档到新结构 ✅

**Created**: 2026-05-12
**Completed**: 2026-05-12

- As a contributor navigating the repo
- I want existing documentation to live in the correct location under the new structure
- So that the docs directory is clean and predictable

**AC:**
- [x] `docs/methodology.md` (ZH) → `docs/guide/zh/methodology.md`
- [x] `docs/methodology-en.md` (EN) → `docs/guide/en/methodology.md`
- [x] `docs/skill-selection-guide.md` → `docs/guide/en/skills.md` + `docs/guide/zh/skills.md`（内容按语言拆分）
- [x] `docs/loop-autorun-verification.md` → `docs/practices/loop-autorun-verification.md`
- [x] `docs/` 根目录不再有散落的 `.md` 文件（briefs/ dream/ guide/ domain/ features/ practices/ 之外）
- [x] 所有移动的文件原路径留 redirect 注释或直接删除（不保留空壳）

**Files:**
- `docs/guide/en/methodology.md` (moved)
- `docs/guide/zh/methodology.md` (moved)
- `docs/guide/en/skills.md` (moved + split)
- `docs/guide/zh/skills.md` (moved + split)
- `docs/practices/loop-autorun-verification.md` (moved)
- `docs/methodology.md` (deleted)
- `docs/methodology-en.md` (deleted)
- `docs/skill-selection-guide.md` (deleted)
- `docs/loop-autorun-verification.md` (deleted)

**Dependencies:**
- Depends on: US-DOC-001, US-DOC-002 (target dirs must exist)
- Depended on by: US-DOC-005

---

<a id="us-doc-005"></a>
## US-DOC-005 README 精简重构 + AGENTS.md Documentation Conventions 章节 ✅

**Created**: 2026-05-12
**Completed**: 2026-05-12

- As a new user landing on GitHub or npm
- I want a README that orients me in 30 seconds and points me to the right docs
- So that I'm not overwhelmed by a 700-line manual

- As an AI agent executing roll skills
- I want clear documentation structure rules in AGENTS.md
- So that I know where to put new docs and which language to use

**AC:**
- [x] `README.md` (EN) 精简至 ≤ 120 行：一句话定义 + 核心价值点×3 + 30秒 Quick Start + Documentation Index 表格
- [x] `README_CN.md` (ZH) 同等精简，结构镜像 EN
- [x] Documentation Index 表格包含所有 guide/en/ 和 guide/zh/ 文件的双语入口
- [x] `AGENTS.md` 新增 `## Documentation Conventions` 章节，包含：
  - [x] 目录用途说明（guide/en, guide/zh, domain, features, practices）
  - [x] 语言规则（EN 正本 → ZH 导出，domain/ 仅 EN，features/ 仅 EN）
  - [x] 新文档落地规则（按类型 → 对应目录）
  - [x] README 职责边界（导航枢纽，不写内容）
  - [x] 维护工作流（EN first → ZH after）

**Files:**
- `README.md` (modified)
- `README_CN.md` (modified)
- `AGENTS.md` (modified — append Documentation Conventions section)

**Dependencies:**
- Depends on: US-DOC-001, US-DOC-002, US-DOC-003, US-DOC-004
- Depended on by: US-DOC-006

---

<a id="us-doc-006"></a>
## US-DOC-006 扩展 roll-.dream：文档覆盖度巡检 + brief 展示 doc coverage ✅

**Created**: 2026-05-12
**Completed**: 2026-05-12

- As a maintainer
- I want dream to automatically detect documentation gaps each night
- So that missing or misplaced docs surface as REFACTOR items without manual auditing

**AC:**
- [x] `roll-.dream/SKILL.md` 新增 Doc Coverage Check 步骤：
  - [x] 扫描 BACKLOG.md ✅ Done stories → 检查 `docs/guide/en/` 有无对应文档 → 缺失生成 REFACTOR
  - [x] 扫描 `docs/guide/en/` 文件 → 检查 `docs/guide/zh/` 有无对应翻译 → 缺失超过一个 release 周期生成 REFACTOR
  - [x] 检查 `docs/` 根目录有无不符合 AGENTS.md Documentation Conventions 的新文件 → 生成 REFACTOR
- [x] REFACTOR 格式：`docs: <具体缺口描述> — flagged by dream <date>`
- [x] `roll-brief/SKILL.md` 新增 Doc Coverage 区块：展示 guide/en 覆盖率、ZH 翻译率
- [x] dream 日志写入 doc coverage 检查结果摘要

**Files:**
- `skills/roll-.dream/SKILL.md` (modified)
- `skills/roll-brief/SKILL.md` (modified)

**Dependencies:**
- Depends on: US-DOC-005 (AGENTS.md conventions must exist first as the rule source)

---

<a id="us-doc-007"></a>
## US-DOC-007 Roll FAQ — 全 AI 自治开发常见问题解答 ✅

**Created**: 2026-05-15
**Completed**: 2026-05-15

- As a product engineer using Roll to manage projects with fully autonomous AI delivery
- I want a bilingual FAQ that answers the most common "why is this happening / what do I do" questions
- So that I can unblock myself without reading source code or filing issues

**Domain Model:**
- Context: Documentation
- Aggregate: `GuideDoc` — `docs/guide/en/faq.md` (EN source) + `docs/guide/zh/faq.md` (ZH mirror)

**AC:**
- [x] `docs/guide/en/faq.md` 存在，覆盖以下场景（每条：现象 → 原因简述 → 解决方案）：
  - Loop 卡住不动 / 一直显示 In Progress
  - Loop 跑完但 BACKLOG 没有更新
  - Agent 评审打回了自己的 PR（CHANGES_REQUESTED）
  - PR 合并冲突 / rebase 失败
  - 切换 agent（`roll agent use kimi`）后 loop 行为有何变化
  - 多个项目同时跑 loop，互相干扰怎么办
  - `gh` 认证失败 / 没有 PR 写权限
  - 如何临时暂停 loop 而不卸载调度
  - 如何看 loop 做了什么（日志 / runs / brief）
  - 什么情况下需要人工介入，什么情况下 loop 会自己恢复
- [x] 每条 FAQ 包含「原理一句话」，帮助用户建立心智模型，而不只是给步骤
- [x] `docs/guide/zh/faq.md` 是 EN 版的完整中文翻译，结构与内容一一对应
- [x] 两个文件均加入 AGENTS.md `Where to Look` 的 guide 指针（如尚未存在）
- [x] README 或 docs 索引中有指向 FAQ 的链接

**Files:**
- `docs/guide/en/faq.md` (new)
- `docs/guide/zh/faq.md` (new)
- `tests/unit/roll_doc_faq.bats` (new, 16 tests)
- `README.md` (modified — docs index)
- `README_CN.md` (modified — docs index)

**Dependencies:**
- Depends on: US-DOC-001, US-DOC-002（guide/ 目录结构已就位）
- Depended on by: 无

---

<a id="us-doc-008"></a>
## US-DOC-008 建立 docs/features.md SOT + 发版时自动同步 ✅

**Created**: 2026-05-16
**Completed**: 2026-05-16

- As a roll user / contributor
- I want a single product-facing catalog that lists every Feature roll currently provides
- So that I can understand the product at a Feature granularity (not Story granularity), and the catalog stays in sync with what actually ships

**Concept clarification:**
- Story = 构建视角，发布单位，多对一映射到 Changelog 条目
- Changelog = 发版时面向用户的一句话总结，按版本组织
- Feature = 产品视角，写给用户看；体量比 Epic 小，跨多个 Story；features.md 是 Feature 层的 SOT

**AC:**
- [x] `docs/features.md` 存在，结构：✨ Core Highlights → Features by Domain（按 Epic 分组）
- [x] Catalog 列出仓库中**所有** Feature（不限于有 deep doc 的）；缺 deep doc 的 Feature 仅 plain text，不加链接
- [x] Core Highlights 由 AI 自动产出（不手工维护）
- [x] `scripts/release.sh` 在 `_run_changelog_skill` 之后调用新的 features 同步步骤，AI 整体重写 `docs/features.md` 使其与当前 BACKLOG / docs/features/ 状态一致
- [x] AI 调用与现有 `_run_changelog_skill` 一致（argv 形式；统一改 stdin 留给 REFACTOR-021 一并处理三个 skill）
- [x] `skills/roll-.changelog/SKILL.md` 包含 features.md 重写规则段落（Section 8）
- [x] BACKLOG.md 索引行 anchor 链接有效

**Files:**
- `docs/features.md` (new)
- `scripts/release.sh` (modified)
- `skills/roll-.changelog/SKILL.md` (Section 8 appended)
- `docs/features/documentation.md` (this section)
- `tests/integration/release_features_sync.bats` (new, 8 tests)

**Dependencies:**
- Depended on by: US-DOC-009（dream 新鲜度巡检读 features.md）
