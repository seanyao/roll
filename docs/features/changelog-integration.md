<a id="us-cl-001"></a>
## US-CL-001 roll-build auto-trigger changelog after deploy ✅

**Completed**: 2026-05-10
**Created**: 2026-05-10
**Plan**: [changelog-integration-plan.md](changelog-integration-plan.md)

- As a developer using roll-build
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

- As a developer whose project has no CHANGELOG.md yet
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
