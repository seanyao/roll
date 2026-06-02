#!/usr/bin/env bats
# FIX-171: tests/run.sh must recover from the spurious bats TAP count-mismatch
# that surfaces under `--jobs` parallel mode (bats merges sub-process stderr
# into the validated TAP stream, so a stray line from a backgrounded test
# grandchild is miscounted as an extra test even though every test passed).
#
# A genuine failure always prints a "not ok" line, so run.sh re-runs the suite
# once on a *count-mismatch-only* failure and never masks a real regression.

setup() {
  TEST_TMP="$(mktemp -d)"
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"

  # Mirror just enough of the tree for run.sh to resolve its paths.
  mkdir -p "$TEST_TMP/tests/helpers/bats-core/bin"
  mkdir -p "$TEST_TMP/tests/unit"
  cp "${REPO_ROOT}/tests/run.sh"          "$TEST_TMP/tests/run.sh"
  cp "${REPO_ROOT}/tests/helpers/tier.bash" "$TEST_TMP/tests/helpers/tier.bash"

  # One discoverable test file so `find tests/unit -name '*.bats'` is non-empty.
  # Its contents are irrelevant — the fake bats below ignores its arguments.
  printf '@test "noop" { true; }\n' > "$TEST_TMP/tests/unit/sample.bats"

  STUB_CALLS="$TEST_TMP/bats-calls"
  : > "$STUB_CALLS"

  # Fake bats: behaviour is selected by $STUB_MODE, invocations are counted in
  # $STUB_CALLS. Both vars are exported by each test and inherited through
  # run.sh → xargs → this stub.
  cat > "$TEST_TMP/tests/helpers/bats-core/bin/bats" <<'STUB'
#!/bin/sh
echo x >> "$STUB_CALLS"
case "$STUB_MODE" in
  spurious)
    # All tests pass, but one stray "ok" line inflates the count by 1.
    printf '1..2\nok 1 a\nok 2 b\nok stray leaked line\n'
    printf '# bats warning: Executed 3 instead of expected 2 tests\n'
    exit 1 ;;
  real)
    # A genuine failure — note the count warning is also present, to prove the
    # "not ok" guard wins over the warning heuristic.
    printf '1..2\nok 1 a\nnot ok 2 b real failure\nok stray\n'
    printf '# bats warning: Executed 3 instead of expected 2 tests\n'
    exit 1 ;;
  *)
    printf '1..1\nok 1 a\n'
    exit 0 ;;
esac
STUB
  chmod +x "$TEST_TMP/tests/helpers/bats-core/bin/bats"
}

teardown() {
  rm -rf "$TEST_TMP"
}

_calls() { grep -c x "$STUB_CALLS"; }

@test "run.sh: spurious count-mismatch (no failing test) is retried then passes" {
  cd "$TEST_TMP"
  STUB_MODE=spurious STUB_CALLS="$STUB_CALLS" run bash tests/run.sh --tier=all tests/unit
  [ "$status" -eq 0 ]                       # treated as passed
  [ "$(_calls)" -eq 2 ]                     # ran once, retried once
  [[ "$output" == *"re-running suite once"* ]]
}

@test "run.sh: a real 'not ok' failure is never masked by the count warning" {
  cd "$TEST_TMP"
  STUB_MODE=real STUB_CALLS="$STUB_CALLS" run bash tests/run.sh --tier=all tests/unit
  [ "$status" -ne 0 ]                       # real failure propagates
  [ "$(_calls)" -eq 1 ]                     # no retry on a genuine failure
}

@test "run.sh: a clean suite passes on the first run with no retry" {
  cd "$TEST_TMP"
  STUB_MODE=clean STUB_CALLS="$STUB_CALLS" run bash tests/run.sh --tier=all tests/unit
  [ "$status" -eq 0 ]
  [ "$(_calls)" -eq 1 ]                     # ran exactly once
}
