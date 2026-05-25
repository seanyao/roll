#!/usr/bin/env bats
# Integration tests for roll loop log (US-LOOP-016)

load helpers

setup() {
  integration_setup
  mkdir -p "${TEST_TMP}/.roll/cycle-logs"
}
teardown() { integration_teardown; }

# ─── CLI entry: log shows content and no ANSI ────────────────────────────────

@test "roll loop log: shows latest log content via CLI" {
  echo "integration test content line 1" > "${TEST_TMP}/.roll/cycle-logs/20260525-161800-40061.log"
  echo "integration test content line 2" > "${TEST_TMP}/.roll/cycle-logs/20260525-171800-50062.log"

  run_roll loop log
  [ "$status" -eq 0 ]
  # Output must be non-empty
  [[ -n "$output" ]]
  # Must contain the later file's header
  [[ "$output" == *"# cycle 20260525-171800-50062"* ]]
  # Must contain the later file's content
  [[ "$output" == *"integration test content line 2"* ]]
}

@test "roll loop log: output is ANSI-free" {
  echo -e "line with \033[32mgreen\033[0m text" > "${TEST_TMP}/.roll/cycle-logs/20260525-161800-40061.log"

  run_roll loop log
  [ "$status" -eq 0 ]
  # Must not contain ANSI escape sequences
  [[ "$output" != *$'\033['* ]]
  # Content must be present (stripped of ANSI)
  [[ "$output" == *"green"* ]]
}

@test "roll loop log <prefix>: unique prefix match via CLI" {
  echo "prefix match content" > "${TEST_TMP}/.roll/cycle-logs/20260525-161800-40061.log"
  echo "other content" > "${TEST_TMP}/.roll/cycle-logs/20260525-171800-50062.log"

  run_roll loop log 20260525-16
  [ "$status" -eq 0 ]
  [[ "$output" == *"# cycle 20260525-161800-40061"* ]]
  [[ "$output" == *"prefix match content"* ]]
}

@test "roll loop log: friendly message when no logs exist" {
  rmdir "${TEST_TMP}/.roll/cycle-logs"

  run_roll loop log
  [ "$status" -eq 0 ]
  [[ "$output" == *"No cycle logs"* ]]
}
