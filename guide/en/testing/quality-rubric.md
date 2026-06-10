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
  test asserts a price, but pricing lives in `packages/core/src/cost/prices.ts`).

### Fix template

```ts
// BEFORE
it("opus rate is 5/25", () => {
  expect(computeListCost("claude-opus-4-7", usage)).toBe("5.0 25.0");
});

// AFTER — feed a fixed fixture rate table; assert the FORMULA, not the live rates
it("computeListCost multiplies tokens × the injected rate", () => {
  const rates = { "m": { in: 2, out: 4 } };
  expect(computeListCost("m", { input_tokens: 1000, output_tokens: 500 }, rates)).toBe(/* 0.002 + 0.002 */ 0.004);
});
```

Or assert only structural invariants on the production rates (e.g.
`cache_read < input`, `out ≥ in`) so a rate-card move can't redden the suite.

### Real example

`packages/core/test/prices.difftest.test.ts` used to read the live opus/sonnet/haiku
rates directly in the assertions — every rate-card move turned it red without
revealing any regression in the rate-resolution logic. It now feeds a fixed
fixture table for the arithmetic and asserts only structural invariants on the
production rates.

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
- Mocks live in the test file itself rather than in a shared test helper
  module, signaling they were added ad-hoc rather than shared.

### Fix template

```ts
// Use a real ephemeral substrate (tmp git repo, tmpdir). Clean it up in
// afterEach/afterAll. The mock disappears entirely.
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "t-"))); execSync("git init -q", { cwd: dir }); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
```

If a true boundary cannot be exercised cheaply (network, gh, launchctl),
inject it as a port/dependency and pass a fake in the test — the same pattern
`runner-executor.test.ts` uses with `fakePorts()`.

### Real example

Watch for ad-hoc `const gh = () => ({...})` overrides scattered across tests
that exercise loop-PR routing. The fix is an injected `GithubPort` (as in
`packages/cli/test/runner-executor.test.ts`) so the same fake is shared,
deliberate, and discoverable.

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
- A module-level (or `beforeAll`) fixture mutates shared state that nothing
  resets, and a later test depends on it.
- The test passes alone but fails inside the suite (or vice versa).

### Fix template

Create per-test state in `beforeEach` (its own tmpdir / env / fixture), assert,
and clean up in `afterEach`. Cross-test dependencies become explicit only when
truly necessary, and even then they go through a named helper, not implicit
ordering or a shared mutable.

### Real example

Any test file where a `beforeAll` mutates `$HOME` or writes a shared
state-`<slug>.yaml` and a later test in the same file reads it without
re-initializing is a candidate. The fix is per-test isolation through a
fresh `mkdtempSync` + an injected home/root.

---

## ❺ Testing private functions / bypassing the public API

### Definition

The test reaches inside a module to call a private helper directly,
asserting its return value. The helper can be renamed, inlined, or
removed without changing behavior — but the test claims regression.

### Signals

- A test deep-imports an unexported helper from a module's internals and
  calls it by name.
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

A test that asserts the test runner's own bookkeeping (e.g. that a mock was
constructed, or that `beforeEach` ran) adds noise to every CI run without ever
surfacing a project regression. Trust the framework; delete the test.

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

An integration test that hand-rolls a regex chain to parse a plist XML file
for a `<string>` value, instead of importing the project's own plist parser.
Any schema change then forces the test author to fix the inline pattern in
multiple test files — the parser is the single owner that should change.

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
- A tmp path that the test file did not create itself.
- Paths starting with `~`, `${HOME}`, `/Users/`, or `/home/` that the test
file did not create itself.

### Fix template

```ts
// BEFORE — asserts on a file that lives outside the repo
it("skill file is synced", () => {
  expect(readFileSync(`${homedir()}/.roll/skills/roll-.dream/SKILL.md`, "utf8")).toMatch(/Scan 6/);
});

// AFTER — recreate the fixture inside a tmpdir owned by the test
it("skill file includes Scan 6", () => {
  const home = mkdtempSync(join(tmpdir(), "h-"));
  mkdirSync(join(home, ".roll/skills/roll-.dream"), { recursive: true });
  writeFileSync(join(home, ".roll/skills/roll-.dream/SKILL.md"), "### Scan 6 — Doc Freshness\n");
  expect(checkSkillHasScan6({ home })).toBe(true);
});
```

If the test's purpose is truly to verify interaction with an external file,
inject the home/root path (a tmpdir) so the test stays deterministic across
machines.

### Real example

A dream-scan test that asserts on `${HOME}/.roll/skills/roll-.dream/SKILL.md`,
a file outside the repo whose content depends on whether the user ran
`roll setup`. On a machine without Roll installed, or with an older version,
the test fails even though the project code under test is correct. Sandbox the
fixture under a temp `HOME` instead.

---

## How `roll-.dream` consumes this rubric

`roll-.dream` Scan 7 scans the test suite for each category's signals,
emits at most 5 REFACTOR entries per cycle (rate cap to avoid drowning
the backlog), and tags each entry with the matching marker:

```markdown
| REFACTOR-XXX | docs: <one-line description> [test-quality:❶] — flagged by dream YYYY-MM-DD | 📋 Todo |
```

The maintainer triages the REFACTOR queue in the morning brief.
