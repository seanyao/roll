#!/usr/bin/env bats
# E2E integration tests for: roll --help (US-VIEW-003).

load helpers

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() { integration_setup; }
teardown() { integration_teardown; }

@test "roll --help: v2 help page golden path (US-VIEW-003)" {
  run_roll --help
  [ "$status" -eq 0 ]
  # Wordmark
  [[ "$output" == *"roll ·"* ]]
  # Three groups
  [[ "$output" == *"AUTONOMY"* ]]
  [[ "$output" == *"PROJECT"* ]]
  [[ "$output" == *"MACHINE"* ]]
  # Star highlight on at least one command
  [[ "$output" == *"★"* ]]
  # Examples present
  [[ "$output" == *"roll loop"* ]]
  [[ "$output" == *"roll brief"* ]]
}

@test "roll --help: ROLL_UI=v1 falls back to legacy help" {
  ROLL_UI=v1 run_roll --help
  [ "$status" -eq 0 ]
  # Legacy usage() has ASCII banner
  [[ "$output" == *"██"* ]] || [[ "$output" == *"Commands:"* ]]
}

@test "roll help (no dashes): same as roll --help" {
  run_roll help
  [ "$status" -eq 0 ]
  [[ "$output" == *"AUTONOMY"* ]]
}

# FIX-064: legacy help (ROLL_UI=v1) must describe the real artifacts
# produced by cmd_init, matching the README and the v2 renderer.
@test "roll --help (v1): init description shows .roll/features/ not docs/" {
  ROLL_UI=v1 run_roll --help
  [ "$status" -eq 0 ]
  [[ "$output" == *".roll/features/"* ]]
  [[ "$output" != *"+ docs/"* ]]
}
