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

## TCR Test Strategy (Phase 3.0)

Each TCR micro-step needs second-level feedback. The test runner has two
levers that keep that fast without giving up coverage in CI.

### `--affected` — run only the tests touched by the diff

```bash
bash tests/run.sh --affected              # default base = HEAD~1
bash tests/run.sh --affected main         # explicit base ref
bash tests/run.sh --affected --dry-run    # print the file list, don't run
```

Mapping rules (precise → fuzzy → conservative):

1. The changed file *is* the .bats — run it (self-test).
2. Source-naming convention: `lib/foo.py` → `tests/unit/foo*.bats`,
   `tests/integration/*foo*.bats`.
3. Changes to `tests/helpers/*`, `tests/preconditions.bash`, or `tests/run.sh`
   → run everything (no safe subset).

When the affected set is empty (e.g. doc-only change) the runner prints
`no affected tests, skipping suite` and exits 0.

### `--tier` — fast (TCR / local) vs slow (CI / pre-push)

```bash
bash tests/run.sh                   # implicit --tier=fast (default)
bash tests/run.sh --tier=slow
bash tests/run.sh --tier=all        # run everything; CI uses this
```

Classification order (first hit wins):

1. Explicit `# bats tier: fast|slow` header in the .bats file.
2. Path under `tests/integration/` → slow.
3. References `launchctl`, `crontab`, or `sleep N` with N ≥ 5 → slow.
4. Default → fast.

With `ROLL_TEST_TIME_CAP=1` (set in CI), `--tier=fast` enforces a
60-second wall-clock cap (`ROLL_TEST_FAST_CAP_SEC` override). A creeping
perf regression turns the suite red immediately rather than rotting silently.

User-named .bats files bypass the tier filter:
`bash tests/run.sh tests/integration/foo.bats` runs even with `--tier=fast`.

The default combination is `--affected --tier=fast`; pre-push / release run
`--tier=all`.

## Test Quality Rubric

`guide/en/testing/quality-rubric.md` (referenced from `$roll-.dream` Scan 7)
catalogs eight recurring antipatterns the dream nightly scan flags as
`REFACTOR-XXX [test-quality:❶|❷|...|❽]`:

| # | Antipattern | Fix |
|---|-------------|-----|
| ❶ | Hard-coded business data (prices, version strings, product copy) | Inject fixture data via monkey-patch or constructor; assert behaviour, not the data table itself |
| ❷ | Over-mocking (database, filesystem, real boundary) | Use real subsystems behind small adapter mocks; prefer in-memory test doubles |
| ❸ | Asserting implementation details (private symbol names, internal data shape) | Assert observable behaviour through the public API |
| ❹ | Fixture order coupling (shared mutable state between tests) | Setup/teardown each test independently; use immutable fixtures |
| ❺ | Testing private functions / bypassing the public API | Re-route through the public entry point; if it's hard to reach, the API is wrong |
| ❻ | Asserting framework behaviour (testing bats itself) | Delete the test; trust the framework |
| ❼ | Inlining external-tool behaviour (`sed`/`grep`/`awk` pipelines duplicated in test bodies) | Call the project helper that owns the parsing, or extract into `tests/helpers/` |
| ❽ | Asserting on a file outside this repo (`~/.codex`, `~/.kimi`, `~/.roll`, system paths) | Sandbox via `BATS_TMPDIR`, redirect env vars to a tmp dir, never touch live config |

The dream skill emits at most 5 REFACTOR entries per scan, so the backlog
doesn't drown in noise. Refactor them in priority order.

`tests/unit/model_prices.bats` is the canonical ❶ exemplar — assertions
that read live production rates were broken every time the rate card moved,
even when the arithmetic logic was unchanged. The current file uses a
monkey-patched fixture price table for arithmetic tests and asserts
structural invariants (cache_read < input, etc.) on the production PRICES
dict.

## See Also

- [loop.md](loop.md) — how loop enforces TCR discipline per story
- [skills.md](skills.md) — `$roll-build` (delivers + deposits E2E)
