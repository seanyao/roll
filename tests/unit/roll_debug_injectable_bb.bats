#!/usr/bin/env bats
# Unit tests for: roll-debug injectable-bb.js stub
# Verifies the BB diagnostic probe can be injected, collects data, and cleans up.

STUB_PATH="${BATS_TEST_DIRNAME}/../../skills/roll-debug/injectable-bb.js"
TEST_SCRIPT="${BATS_TEST_DIRNAME}/helpers/test-injectable-bb.js"

@test "injectable-bb.js file exists" {
  [ -f "$STUB_PATH" ]
}

@test "injectable-bb.js has valid JavaScript syntax" {
  run node --check "$STUB_PATH"
  [ "$status" -eq 0 ]
}

@test "injectable-bb.js mounts, collects, and unmounts correctly in mocked browser env" {
  run node "$TEST_SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"All tests passed"* ]]
}
