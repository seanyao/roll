# Test Quality Rubric

> Scope: Vitest tests in `packages/*/test/`, used by `roll-.dream` Scan 7 to
> surface anti-patterns as structured REFACTOR entries.
> Chinese version: [quality-rubric.zh.md](./quality-rubric.zh.md)

This rubric publishes eight anti-patterns that make tests give wrong signal —
either false-positive (red on unrelated change) or false-negative (green
while production is broken). Each category has the same four parts:

- **Definition** — what the anti-pattern is
- **Signals** — how to spot it from the test file alone
- **Fix template** — minimal repair pattern (not a full rewrite)
- **Real example** — an actual occurrence inside this repo

Categories are numbered ❶ through ❽. Categories ❶–❻ are advisory (dream
flags them; the maintainer triages). Categories ❼ and ❽ are **blocking**:
the loop cycle's test-quality merge gate (US-QA-012) rejects a PR that
introduces a new ❼ or ❽ violation, even if CI is green.

---

## ❶ Hardcoded business data in assertions

### Definition

The test asserts a literal business value (price, version string, product
copy, model name) instead of importing the value from the module under
test or from a versioned fixture. When the business value changes, every
unrelated test that hardcoded the old value turns red even though the
logic under test still works.

### Signals

- Bare numeric or string literals inside `[[ "$output" == *"..."*` /
  `[ "$output" = "..." ]` that match values living in the source module.
- The same literal appears in ≥2 test files (price tables, version
  numbers, model identifiers).
- The test file is not the canonical owner of the value (e.g. a runner
  test asserts a price, but pricing lives in `lib/model_prices.py`).

### Fix template

```bash
# BEFORE
@test "opus rate is 5/25" {
  run my_cmd
  [[ "$output" == *"5.0 25.0"* ]]
}

# AFTER — import the value from the source of truth
@test "opus rate matches PRICES[claude-opus-4-7]" {
  expected=$(python3 -c "import lib.model_prices as m; \
    p=m.PRICES['claude-opus-4-7']; print(p['in'], p['out'])")
  run my_cmd
  [[ "$output" == *"$expected"* ]]
}
```

Or replace the literal with an injection fixture (`tests/fixtures/prices.json`)
so the value lives in one place and only assertions on the **formula**
remain in the test.

### Real example

`tests/unit/model_prices.bats` lines 15–31 hardcode the opus/sonnet/haiku
rates (`5.0 25.0`, `3.0 15.0`, `1.0 5.0`) directly in the assertion bodies.
Any pricing adjustment on the source module turns these tests red without
revealing any actual regression in the rate-resolution logic.

---

## ❷ Over-mocking

### Definition

The test mocks a boundary it should be hitting for real — database,
filesystem, child-process spawn, git command — so the test passes against
a mock that doesn't behave like the real thing. The test ships green; the
first integration run breaks.

### Signals

- `function git() { … }` / `function gh() { … }` overrides at the top of
  a unit test that exercises real git or gh behavior.
- A SQL or filesystem call replaced with an inline stub returning a
  hand-rolled string.
- Mocks live in the test file itself rather than in `tests/helpers/`,
  signaling they were added ad-hoc rather than shared.

### Fix template

```bash
# Use a real ephemeral substrate (tmp git repo, sqlite file, tmpdir).
# Tear it down in teardown(). The mock disappears entirely.
setup() {
  TMP=$(mktemp -d); cd "$TMP"; git init -q
}
teardown() { rm -rf "$TMP"; }
```

If a true boundary cannot be exercised in unit scope (network calls,
launchctl, etc.), move the test to `tests/integration/` and accept it
runs in the slow tier — not mocked.

### Real example

Watch for ad-hoc `function gh() { echo '{...}' }` overrides at the top of
unit tests that test loop-PR routing. The fix is to use bats helpers in
`tests/helpers/` so the same fake is shared, deliberate, and discoverable.

---

## ❸ Asserting on implementation details

### Definition

The test asserts on the *shape* of internal state (private function
names, intermediate variable contents, file path of an internal cache)
rather than the observable behavior. A refactor that preserves behavior
breaks the test, blocking the refactor for no good reason.

### Signals

- `grep -q '_internal_helper' "$output"` — asserting a private symbol
  name is leaked to output.
- `[[ "$(cat .roll/internal/_cache.tmp)" == ... ]]` — asserting on an
  internal cache file path that the public API never promised.
- The assertion would still pass after a meaningful behavioral
  regression because it checks the wrong layer.

### Fix template

Re-anchor the assertion to the **public effect**: exit code, observable
output, state visible to a caller. If the internal detail is the only
thing visible, the production code probably needs a thin public API to
expose the behavior intentionally.

### Real example

Tests asserting `grep -q '_loop_check_depends_on' <output>` would break
the moment the helper is renamed, even though the gating logic is
unchanged. The right assertion is "story X is skipped because dep Y
is unsatisfied," verified through the public side effect (story stays
📋 Todo, log line emitted).

---

## ❹ Fixture order coupling

### Definition

Tests share mutable state (a file, an env var, a temp dir) and rely on
running in a specific order. Parallel runs, `--filter`, or reshuffling
cause sporadic failures that look like flakes.

### Signals

- A test reads state another test in the same file wrote.
- `setup_file()` creates state that `teardown_file()` never tears down,
  and a later test depends on it.
- The test passes alone but fails inside the suite (or vice versa).

### Fix template

Move all setup into `setup()` (per-test) instead of `setup_file()`. Each
test creates its own tmpdir / env / fixture, asserts, and tears down.
Cross-test dependencies become explicit only when truly necessary, and
even then they go through a named helper, not implicit ordering.

### Real example

Any bats file where `setup_file()` mutates `$HOME` or writes to a shared
state-`<slug>.yaml` and a later test in the same file reads it without
re-initializing is a candidate. The fix is per-test isolation through
`mktemp -d` + an explicit `HOME=$tmp` override.

---

## ❺ Testing private functions / bypassing the public API

### Definition

The test reaches inside a module to call a private helper directly,
asserting its return value. The helper can be renamed, inlined, or
removed without changing behavior — but the test claims regression.

### Signals

- A test sources `lib/internal/foo.sh` and calls `_private_helper` by
  name.
- The function name starts with `_` (project convention for private),
  yet a test depends on its signature.
- The public API isn't exercised at all in the file; the test is
  effectively testing the internal decomposition.

### Fix template

Route the call through the public entry point (`roll <cmd>` /
`my-tool foo`). If the public API doesn't cover the case being tested,
that's a feature gap — either the case is unreachable (delete the
test) or the public API needs a new flag (add it intentionally).

### Real example

A test that reaches into a private helper (importing an unexported
`_loopCheckDependsOn` via a back door) instead of running the command and
observing the skip decision in the run log. The first form locks the helper
name; the second tests the behavior the user cares about.

---

## ❻ Asserting on framework behavior

### Definition

The test exercises Vitest itself (or any framework) rather than the
project code: asserting that `beforeEach` runs before tests, that a mock
records calls, that `expect` exists. These assertions pass because the
framework works; they tell us nothing about the project.

### Signals

- Assertions on framework internals / the test runner's own behavior.
- A test whose body is only setup/teardown verification with no call to
  project code.
- Tests added after a framework upgrade to "make sure Vitest still works."

### Fix template

Delete the test. Framework verification belongs upstream. If the project
relies on a specific framework guarantee, document that contract in a shared
test helper and run one smoke test, not a category of them.

### Real example

A test that asserts `$BATS_TEST_NUMBER > 0` adds noise to every CI run
without ever surfacing a project regression. The right place for that
assurance is a one-time check in CI configuration, not in the suite.

---

## ❼ Test inlines external tool behaviour

### Definition

The test body re-implements the behaviour of external tools (`sed`, `grep`,
`find`, `awk`, `tr`) via inline shell pipelines, instead of calling a
project function that encapsulates that logic. When the project replaces
the external tool or changes the internal parsing, every test that copied
the pipeline breaks — even though the public-API output didn't change.

### Signals

- `foo=$(echo "$output" | grep ... | sed ... | awk ...)` chains inside
the test body.
- The same pipeline appears in ≥2 test files (duplicated parsing logic).
- A project function exists (or should exist) that encapsulates this
parsing, but the test bypasses it and rolls its own inline version.

### Fix template

```ts
// BEFORE — inline regex replicates what a project function already does
const label = /<key>Label<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];

// AFTER — call the project function that owns the parsing
import { plistString } from "../src/lib/plist.js";
const label = plistString(plist, "Label");
```

If no project function exists, extract the parsing into a named test helper
module so the logic is shared and deliberate.

### Real example

`tests/integration/cmd_loop.bats` line 181 — inline `grep -A1 | grep | sed`
chain parses a plist XML file to extract a `<string>` value. The project
already has `plutil` available on macOS and could wrap the pattern in a
`_plist_get_string` helper. Any plist schema change forces the test author
to fix the inline pipeline in multiple test files.

---

## ❽ Test asserts on a file outside this repo

### Definition

The test assertion reads or asserts on a file path outside the repository
root (e.g. `~/.roll/`, `~/.codex/`, `/etc/`, `/tmp/other-project/`). When
the repo is cloned on a different machine, or the user's home directory
has different state, the test either fails spuriously or — worse — passes
by coincidence while testing the wrong thing.

### Signals

- `[[ -f ~/.xxx/... ]]`, `[[ -d ~/.xxx/... ]]`, `cat ~/.xxx/...` inside
an assertion.
- `[[ -f /tmp/... ]]` where `/tmp/...` was not created by `setup()` in the
same test file.
- Paths starting with `${HOME}` or `/Users/` or `/home/` that the test
file did not create itself.

### Fix template

```bash
# BEFORE — asserts on a file that lives outside the repo
@test "skill file is synced" {
  grep -qE 'Scan 6' "${HOME}/.roll/skills/roll-.dream/SKILL.md"
}

# AFTER — recreate the fixture inside a tmpdir owned by the test
@test "skill file includes Scan 6" {
  mkdir -p "$TMP/.roll/skills/roll-.dream"
  echo '### Scan 6 — Doc Freshness' > "$TMP/.roll/skills/roll-.dream/SKILL.md"
  ROLL_HOME="$TMP/.roll" run check_skill_has_scan6
  [ "$status" -eq 0 ]
}
```

If the test's purpose is truly to verify interaction with an external file,
use `ROLL_HOME` injection (set to a tmpdir in `setup()`) so the test stays
deterministic across machines.

### Real example

`tests/unit/roll_dream_scan6.bats` line 49 — asserts on
`${HOME}/.roll/skills/roll-.dream/SKILL.md`, a file outside the repo whose
content depends on whether the user ran `roll setup`. On a machine without
Roll installed, or with an older version, the test fails even though the
project code under test is correct.

---

## How `roll-.dream` consumes this rubric

`roll-.dream` Scan 7 scans the test suite for each category's signals,
emits at most 5 REFACTOR entries per cycle (rate cap to avoid drowning
the backlog), and tags each entry with the matching marker:

```markdown
| REFACTOR-XXX | docs: <one-line description> [test-quality:❶] — flagged by dream YYYY-MM-DD | 📋 Todo |
```

The maintainer triages the REFACTOR queue in the morning brief.
