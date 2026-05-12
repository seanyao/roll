#!/usr/bin/env bats
# E2E integration tests for: roll loop notify (US-NOTIFY-001)

load helpers

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup()    { integration_setup; }
teardown() { integration_teardown; }

@test "roll loop notify: exits 0 when muted (golden path)" {
  mkdir -p "${TEST_TMP}/.shared/roll"
  touch "${TEST_TMP}/.shared/roll/mute"
  run_roll loop notify "roll ✅ Story Done" "US-TEST-001 shipped"
  [ "$status" -eq 0 ]
}

@test "roll loop notify: exits 0 with no args" {
  mkdir -p "${TEST_TMP}/.shared/roll"
  touch "${TEST_TMP}/.shared/roll/mute"
  run_roll loop notify
  [ "$status" -eq 0 ]
}

@test "roll loop notify: exits 0 when no mute file exists" {
  # Without mute, on non-Darwin or when osascript unavailable, should still return 0
  # We can't guarantee osascript behavior in CI, so just verify no crash
  run_roll loop notify "Test" "body"
  [ "$status" -eq 0 ]
}
