<a id="us-cl-001"></a>
## US-CL-001 roll-build auto-trigger changelog after deploy ✅

**Completed**: 2026-05-10
**Created**: 2026-05-10
**Plan**: [changelog-integration-plan.md](changelog-integration-plan.md)

- As a product engineer using roll-build
- I want changelog to be generated automatically after every successful deploy
- So that CHANGELOG.md stays in sync with delivered work without manual effort

**AC:**
- [x] Phase 12 (Report & Celebrate) includes `$roll-.changelog` call after deploy verification
- [x] Trigger happens automatically, no user action needed
- [x] roll-fix also triggers `$roll-.changelog` after successful deploy

**Files:**
- `skills/roll-build/SKILL.md`
- `skills/roll-fix/SKILL.md`

**Dependencies:**
- Depends on: none
- Depended on by: US-CL-002 (changelog skill needs to handle the call)

---

<a id="us-cl-002"></a>
## US-CL-002 roll-.changelog support first-time creation with backfill ✅

**Completed**: 2026-05-10
**Created**: 2026-05-10
**Plan**: [changelog-integration-plan.md](changelog-integration-plan.md)

- As a product engineer whose project has no CHANGELOG.md yet
- I want roll-.changelog to create the file and backfill all historical completed Stories
- So that the changelog is complete from day one, not missing earlier work

**AC:**
- [x] When `CHANGELOG.md` exists: append current deploy's changes (existing behavior)
- [x] When `CHANGELOG.md` does not exist: create it, extract all ✅ Done Stories from BACKLOG.md, write entries grouped by completion date in reverse chronological order
- [x] Workflow section documents both paths (create vs append)

**Files:**
- `skills/roll-.changelog/SKILL.md`

**Dependencies:**
- Depends on: US-CL-001 (needs the trigger to be wired)
- Depended on by: none

<a id="us-cl-003"></a>
## US-CL-003 消除独立的 changelog commit — 并入 story 完成提交 ✅

**Completed**: 2026-05-11
**Created**: 2026-05-12

- As a developer reading git log
- I want changelog updates to be part of the story completion commit
- So that `docs: update changelog for release YYYY.MM.DD` 这类噪音 commit 不再出现

**AC:**
- [x] `roll-.changelog` Step 6 移除 `git commit` / `git push`，只做 `git add CHANGELOG.md`（stage 不提交）
- [x] `roll-build` Phase 11 的完成 commit（`docs: mark US-XXX as completed`）自动包含已 stage 的 CHANGELOG.md
- [x] git log 中不再出现单独的 `docs: update changelog for ...` commit
- [x] 若 `roll-.changelog` 在无 roll-build 上下文中独立触发（手动），则保留一次独立 commit，消息改为 `chore: sync changelog`（去掉日期）

**Files:**
- `skills/roll-.changelog/SKILL.md` — 移除 Step 6 的 commit/push，改为仅 stage
- `skills/roll-build/SKILL.md` — Phase 11 commit 前确认 CHANGELOG.md 已 stage

**Dependencies:**
- Depends on: US-CL-001, US-CL-002

---

<a id="us-cl-004"></a>
## US-CL-004 changelog 风格守门 Phase 1 — 机械 linter + few-shot 锚点 📋

**Created**: 2026-05-13

- As a roll 用户
- I want changelog 生成时自动挡掉技术黑话，并参考最近成品的风格
- So that 不用每次发版手工重写条目（参见 4a12ccf）

**Domain Model:**
- Context: Documentation > Changelog
- Aggregate: ChangelogEntry (Root) owns [Bullet]
- Events raised: [BulletRejected] → 触发 agent 重写
- Cross-context: 无

**Background**：`roll-.changelog` SKILL.md 已写明完整风格规则（30 字、不写实现细节、❌/✅ 对照），但 loop 跑完 build 时 agent 上下文里全是刚写的函数名 / Phase / 文件路径，照抄最省力，规则被忽略。4a12ccf 实证：v2026.513.1 全部 9 条要人工重写。

**AC:**
- [ ] `roll-.changelog` skill 加 Step 5.4 "Mechanical Lint"：对每条 draft bullet 跑黑名单 grep，命中任一即视为违规
  - 反引号包裹的标识符含 `_` 或 `()`（如 `` `_write_loop_runner_script` `` / `` `fn()` ``）
  - 含文件后缀 `.md` / `.sh` / `.yml` / `.ts` / `.bats`（除非作为用户命令的一部分）
  - 含 "Phase \d" / "Step \d" / "Helper" / "Schema" / "Fixture" / "Refactor" 这类内部词
  - 单条字符数 > 50（中文按字符计）
  - 含目录路径片段 `docs/` / `bin/` / `tests/` / `scripts/`
- [ ] 命中后 skill 把违规清单 + 原文回给 agent，要求重写；最多 2 轮，仍不过则保留该条但前面加 `⚠️ ` 标记，写 ALERT 让人介入
- [ ] skill 加 Step 5.3 "Style Anchors"：动态读 `CHANGELOG.md` 顶部最近 3 个 `## v` 节的全部 bullets（截断到总 1500 字），插入到 Step 5 生成阶段的上下文里作为 in-context 示例
- [ ] 单元测试覆盖 linter 每条黑名单规则（命中 / 不命中分支）
- [ ] 回归测试：把 4a12ccf 之前的 10 条草稿喂进 linter，应全部命中并要求重写

**Files:**
- `skills/roll-.changelog/SKILL.md` — 加 Step 5.3（style anchors）+ Step 5.4（mechanical lint）
- `tests/unit/roll_changelog_lint.bats` — 新增（如果 lint 用 bash 函数实现）
- 或 `bin/roll` 加 `_changelog_lint_bullet` helper + 单测

**Dependencies:**
- Depends on: 无（纯加法 skill 改动）
- Depended on by: US-CL-005

---

<a id="us-cl-005"></a>
## US-CL-005 changelog 风格守门 Phase 2 — 自审 gate 📋

**Created**: 2026-05-13

- As a roll 用户
- I want changelog 生成在 stage 之前必须过一次自审 checklist
- So that 哪怕 linter 漏过的"虽然短但很技术"的条目也会被挡

**Domain Model:**
- Context: Documentation > Changelog
- Aggregate: ChangelogEntry (Root) owns [Bullet, AuditVerdict]
- Events raised: [BulletAuditFailed] → 触发 agent 重写；[ChangelogAuditPassed] → 允许 stage
- Cross-context: 无

**AC:**
- [ ] `roll-.changelog` skill 在 Step 5 生成 / Step 5.4 lint 通过之后、Step 6 stage 之前加 Step 5.5 "Self-Audit"
- [ ] checklist 为布尔判定（5 项均通过才算 pass）：
  - 字符数 ≤ 30（除非引用了用户命令）
  - 无内部标识符（函数名 / 字段名 / 配置键）
  - 无文件路径 / 后缀
  - 无 "Phase N" / "Step N" / 阶段编号
  - 句式符合"功能名 — 用户能做什么 / 不再被什么坑"或"功能名 不再 / 现在 …"
- [ ] 任一为否 → 重写该条；累计 3 轮仍失败 → 写 ALERT（含被卡条目原文）+ 保留 `## Unreleased` 加 ⚠️ 标记，不阻断 stage（避免阻塞 loop）
- [ ] 自审输出结构化日志（每条 bullet 的 5 项判定结果），写入 `~/.shared/roll/loop/changelog-audit.jsonl`，便于事后回看 agent 是不是在糊弄
- [ ] 单元测试覆盖：5 条 checklist 的各 pass / fail 分支；3 轮重试上限；ALERT 写入路径

**Files:**
- `skills/roll-.changelog/SKILL.md` — 加 Step 5.5（self-audit）
- `bin/roll` — 加 `_changelog_audit_log` helper（写 jsonl）
- `tests/unit/roll_changelog_audit.bats` — 新增

**Dependencies:**
- Depends on: US-CL-004（linter + few-shot 先落地，audit 才有锚点参考）
- Depended on by: 无
