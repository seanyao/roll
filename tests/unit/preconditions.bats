#!/usr/bin/env bats
# Meta tests for tests/preconditions.bash (US-QA-004).
# Verifies the helper opt-in contract: present-and-noisy when condition holds,
# silent when it doesn't.

load helpers

setup() {
  # Snapshot real env so tests don't leak into each other or the harness.
  _SAVED_CYCLE_ID="${CYCLE_ID:-__unset__}"
  unset CYCLE_ID
}

teardown() {
  if [[ "$_SAVED_CYCLE_ID" == "__unset__" ]]; then
    unset CYCLE_ID
  else
    export CYCLE_ID="$_SAVED_CYCLE_ID"
  fi
}

# Sanity: the helper file is sourced and the function is defined.
@test "preconditions: require_not_in_real_loop is defined after load helpers" {
  run type -t require_not_in_real_loop
  [ "$status" -eq 0 ]
  [ "$output" = "function" ]
}

@test "require_not_in_real_loop: passes through when CYCLE_ID is unset" {
  unset CYCLE_ID
  run require_not_in_real_loop
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "require_not_in_real_loop: passes through when CYCLE_ID is empty string" {
  CYCLE_ID="" run require_not_in_real_loop
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# When CYCLE_ID is set the helper must call `skip`. `skip` itself can't be
# observed via `run` (bats' skip relies on test-frame state), so stub it in a
# subshell and verify the helper invokes it with a CYCLE_ID-bearing reason.
@test "require_not_in_real_loop: invokes skip with CYCLE_ID reason" {
  run bash -c '
    source "'"${BATS_TEST_DIRNAME}"'/../preconditions.bash"
    skip() { echo "SKIPPED: $*"; exit 0; }
    export CYCLE_ID="cycle-abc-123"
    require_not_in_real_loop
    echo "FELL_THROUGH"
  '
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIPPED:"* ]]
  [[ "$output" == *"CYCLE_ID=cycle-abc-123"* ]]
  [[ "$output" != *"FELL_THROUGH"* ]]
}

# End-to-end: a real test using `require_not_in_real_loop` in setup() must be
# reported as skipped (not failed) when CYCLE_ID is set. Spawn a sub-bats run
# against an inline fixture to confirm bats' own reporting.
@test "require_not_in_real_loop: bats reports skipped, not failed, under CYCLE_ID" {
  local fixture; fixture="$(mktemp -d)/skip_fixture.bats"
  cat > "$fixture" <<'EOF'
load "PRECONDITIONS_PATH"
setup() { require_not_in_real_loop; }
@test "should be skipped" { false; }
EOF
  # Bake the absolute path into the fixture so it works from any cwd.
  sed -i.bak "s|PRECONDITIONS_PATH|${BATS_TEST_DIRNAME}/../preconditions|g" "$fixture"
  rm -f "${fixture}.bak"

  CYCLE_ID="cycle-meta-test" run bats "$fixture"
  [ "$status" -eq 0 ]
  [[ "$output" == *"# skip"* ]]
  [[ "$output" != *"not ok"* ]]
}
