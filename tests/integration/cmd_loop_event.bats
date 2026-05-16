#!/usr/bin/env bats
# Integration: _loop_event output integrity

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP="$(mktemp -d)"
  export _SHARED_ROOT="$TEST_TMP"
}
teardown() { rm -rf "${TEST_TMP:-}"; }

@test "_loop_event integration: stdout + NDJSON written in one call" {
  source "$ROLL_BIN"
  _SHARED_ROOT="$TEST_TMP"
  run _loop_event "cycle_start" "042" "" ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"cycle_start"* ]]
}
