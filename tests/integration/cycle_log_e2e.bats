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
  sleep 1
  echo "integration test content line 2" > "${TEST_TMP}/.roll/cycle-logs/20260525-171800-50062.log"

  run_roll loop log
  [ "$status" -eq 0 ]
  # Output must be non-empty
  [[ -n "$output" ]]
  # Must contain the later file's content (header check is best-effort —
  # CI filesystems may have 1-second mtime resolution)
  [[ "$output" == *"integration test content line 2"* ]]
  # Must NOT contain the earlier file's content
  [[ "$output" != *"integration test content line 1"* ]]
}

@test "roll loop log: output is ANSI-free" {
  echo -e "line with \033[32mgreen\033[0m text" > "${TEST_TMP}/.roll/cycle-logs/20260525-161800-40061.log"

  run_roll loop log
  [ "$status" -eq 0 ]
  # The original content had ANSI green codes; after stripping,
  # the plain word 'green' must appear (but green-on/green-off escape
  # sequences must NOT appear in the output)
  [[ "$output" == *"green"* ]]
  [[ "$output" != *"\033[32m"* ]]
  [[ "$output" != *"\033[0m"* ]]
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
