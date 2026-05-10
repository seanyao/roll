<a id="us-qa-001"></a>
## US-QA-001 roll-build Phase 5.5 — E2E Deposit ✅

**Completed**: 2026-05-10

**Created**: 2026-05-10
**Plan**: [e2e-lifecycle-plan.md](e2e-lifecycle-plan.md)

- As a product engineer using roll-build
- I want each Story to automatically deposit an E2E test for its core user flow
- So that the project accumulates a replayable E2E suite as a natural byproduct of delivery

**AC:**
- [x] Phase 5.5 section added between Phase 5 (TCR Loop) and Phase 6 (Pre-Push CI Gate)
- [x] Phase detects project's existing E2E infrastructure (directories, config, framework, naming)
- [x] When E2E infrastructure exists: writes one test following project conventions, runs green, commits as TCR micro-step
- [x] When no E2E infrastructure exists: references roll-.qa "Missing Test Infrastructure" section for bootstrap path
- [x] Definition of Done updated to include "E2E deposited"
- [x] Required Artifacts updated to include E2E test file

**Files:**
- `skills/roll-build/SKILL.md`

**Dependencies:**
- Depends on: none
- Depended on by: US-QA-002 (CI needs E2E tests to gate)

---

<a id="us-qa-002"></a>
## US-QA-002 Template CI add E2E gating step ✅

**Completed**: 2026-05-10
**Created**: 2026-05-10
**Plan**: [e2e-lifecycle-plan.md](e2e-lifecycle-plan.md)

- As a product engineer using a Roll-managed project
- I want CI to run E2E tests on every push
- So that regressions are caught automatically before merge

**AC:**
- [x] `template/.github/workflows/ci.yml` includes E2E test step after unit tests
- [x] E2E step runs the project's existing test command (e.g., `npm run test:e2e`)
- [x] Step fails gracefully if no E2E tests exist yet (does not block projects without E2E)

**Files:**
- `template/.github/workflows/ci.yml`

**Dependencies:**
- Depends on: US-QA-001 (Phase 5.5 creates the tests CI will run)
- Depended on by: none

---

<a id="us-qa-003"></a>
## US-QA-003 roll-.qa add CI failure triage guidance ✅

**Completed**: 2026-05-10
**Created**: 2026-05-10
**Plan**: [e2e-lifecycle-plan.md](e2e-lifecycle-plan.md)

- As a product engineer whose CI just went red
- I want roll-.qa to guide me on triaging failures and routing them to roll-fix
- So that CI failures become actionable BACKLOG items instead of vague red badges

**AC:**
- [x] New "CI Failure Triage" section added to roll-.qa SKILL.md
- [x] Guidance on reading CI logs and classifying failure severity (Critical/High/Medium/Low)
- [x] Guidance on creating FIX-XXX entries from CI failures
- [x] Reference to roll-fix for execution

**Files:**
- `skills/roll-.qa/SKILL.md`

**Dependencies:**
- Depends on: none
- Depended on by: none
