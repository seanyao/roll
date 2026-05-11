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
