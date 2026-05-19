# E2E Lifecycle — Design Plan

**Created**: 2026-05-10

## Problem

Roll's conventions mandate E2E testing ("E2E for flows" in `conventions/global/AGENTS.md`), and `roll-.qa` defines a complete Playwright test pyramid. But two gaps exist:

1. **No write head**: `roll-build` doesn't deposit E2E tests during Story delivery. Tests accumulate only if developers remember to write them.
2. **No read head in CI**: `template/.github/workflows/ci.yml` runs `lint → build → test` but has no explicit E2E step. Deposited tests would have nowhere to gate.

## Key Design Decision

**Feature E2E and project QA are inseparable** — they are the same artifact at different scales:

- `roll-build` Phase 5.5 deposits one E2E test per Story (write head)
- CI runs all deposited E2E tests on every push (read head)
- No separate `roll-qa` skill — CI is the runner, Roll ensures tests exist

## Principles

1. **Detect, don't prescribe** — Phase 5.5 reads the project's existing test infrastructure and follows whatever conventions already exist. No hardcoded stack table.
2. **Bootstrap when empty** — When a project has no E2E infrastructure, reference `roll-.qa`'s "Missing Test Infrastructure" guidance to set up minimally.
3. **CI gates, Sentinel patrols** — CI runs deterministic E2E on every push (localhost). Sentinel does AI-powered production sampling. Different mechanisms, complementary purposes.

## Scope

| Item | What | Where |
|------|------|-------|
| US-QA-001 | Phase 5.5 E2E Deposit in roll-build | `skills/roll-build/SKILL.md` |
| US-QA-002 | Template CI add E2E gating step | `template/.github/workflows/ci.yml` |
| US-QA-003 | roll-.qa add CI failure triage guidance | `skills/roll-.qa/SKILL.md` |

## Out of Scope

- Per-stack CI templates (Java, Python, iOS, etc.) — future work
- roll-qa as a separate skill — decided against
- Sentinel template changes — current positioning is correct
