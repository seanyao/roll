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
