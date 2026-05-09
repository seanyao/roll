<a id="us-debug-001"></a>
## US-DEBUG-001 Add BB Injection mode to roll-debug 📋

**Created**: 2026-05-04
**Plan**: [roll-debug-plan.md](roll-debug-plan.md)

- As a roll-debug user
- I want roll-debug to inject a BB-compatible collector when the target page has no native BB
- So that diagnostic data is always collected through a unified BB interface, regardless of whether the page integrates BB

**AC:**
- [ ] `skills/roll-debug/SKILL.md` documents three collection modes: Native BB, Injected BB, Universal Fallback
- [ ] `skills/roll-debug/injectable-bb.js` exists and exposes `window.__BB_DATA__` + `[data-testid="bb-toggle"]`
- [ ] Injection stub collects: console (error/warn/log), network (failed/slow), JS errors, DOM snapshot, performance metrics
- [ ] Injection stub output schema matches Native BB format
- [ ] Auto-detect flow: Native → Inject (if no `--universal`) → Universal fallback (on timeout/failure)
- [ ] New CLI flags documented: `--bb-sdk-url`, `--universal`, `--inject-bb`
- [ ] Injection timeout is 5s; fallback to Universal is automatic and logged
- [ ] Capability comparison table in SKILL.md covers all three modes
- [ ] At least one usage example shows Injected BB mode output

**Files:**
- `skills/roll-debug/SKILL.md`
- `skills/roll-debug/injectable-bb.js` (new)

**Dependencies:**
- Depends on: none
- Depended on by: none

---

<a id="us-debug-002"></a>
## US-DEBUG-002 roll-debug auto-fix — diagnose then auto-TCR when fixable ✅

**Completed**: 2026-05-10
**Created**: 2026-05-10

- As a developer debugging a broken page
- I want roll-debug to automatically fix the issue when the root cause is in project source code
- So that diagnosis and repair happen in one continuous flow without manual handoff

**AC:**
- [x] After diagnosis, roll-debug assesses if root cause is in project source and fixable
- [x] If fixable (single-file, bounded): auto-enters roll-fix's TCR workflow (test → fix → review → commit → push → CI → deploy)
- [x] If complex (cross-module, architectural): creates US-XXX, suggests `$roll-build`
- [x] If external (third-party API, infra): reports findings only with suggested actions
- [x] After successful fix: re-mounts BB probe, re-verifies the issue is resolved on the page
- [x] All roll-fix quality gates preserved (TCR, roll-.review, push, CI)
- [x] Integration section in SKILL.md rewritten to reflect auto-fix behavior and escalation paths
- [x] Tells user what was found and what was done (or why it couldn't auto-fix)

**Files:**
- `skills/roll-debug/SKILL.md`

**Dependencies:**
- Depends on: none
- Depended on by: none
