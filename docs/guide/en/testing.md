# Roll — Testing Workflow

Roll enforces a test-first discipline throughout delivery:

- **TCR** (Test && Commit || Revert) — every micro-step passes tests before committing.
- **E2E Deposit** — each completed Story leaves an E2E test covering its golden path.
- **CI E2E Gate** — the deposited E2E runs on every push, blocking merges on failure.
- **proof-of-pass** — pre-commit hook physically blocks commits that haven't passed tests.

## E2E Deposit

After TCR micro-steps pass, `$roll-build` Phase 5.5 deposits an E2E test:

1. Detects your project's existing E2E infrastructure (framework, directory, naming).
2. Writes one E2E test covering the Story's critical user path.
3. Runs it — fixes via TCR if red.
4. Commits: `tcr: e2e deposit for <story-id>`.

The deposited test becomes a durable regression guard that CI and `$roll-sentinel`
can replay against production.

## Pre-commit Hook (proof-of-pass)

Roll's pre-commit hook blocks commits unless tests passed within the last 60 seconds
**on the exact tree being committed**:

```bash
# Proof written by test runner:
# .roll/last-test-pass  ← timestamp + tree hash

# Hook checks at commit time:
# - elapsed < 60 s
# - tree hash matches current staged tree
```

To satisfy the hook, run your tests immediately before committing. If you use TCR
(which roll-build does), this is automatic.

## CI E2E Gate

The template CI workflow (`.github/workflows/ci.yml`) runs E2E tests as a
separate job that must pass before merge. If E2E fails:

1. Check the failing test name — it corresponds to a Story ID.
2. Run the test locally to reproduce.
3. Open a `FIX-XXX` entry in `BACKLOG.md`, or use `$roll-fix` to fix immediately.

## Failure Triage

`$roll-.qa` provides structured guidance for diagnosing test failures at each
layer of the test pyramid:

| Layer | Run command | Triage starting point |
|-------|-------------|-----------------------|
| Unit | `bats tests/unit/` | Failing test file → function name |
| Integration | `bats tests/integration/` | Setup/teardown, real processes |
| E2E | `<project E2E command>` | User path, environment |
| Smoke | `roll doctor` | Toolchain health |

## See Also

- [loop.md](loop.md) — how loop enforces TCR discipline per story
- [skills.md](skills.md) — `$roll-build` (delivers + deposits E2E)
