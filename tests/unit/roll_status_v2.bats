#!/usr/bin/env bats
# Unit tests for lib/roll-status.py + cmd_status dispatch (US-VIEW-004)

LIB="${BATS_TEST_DIRNAME}/../../lib"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

# FIX-076: fixture data is gated on the ROLL_RENDER_FIXTURE env var; user-facing
# CLI no longer exposes --demo. Tests opt into fixture rendering explicitly.
_run_fixture() {
  ROLL_RENDER_FIXTURE=1 run python3 "${LIB}/roll-status.py" --no-color "$@"
}

@test "roll-status fixture --no-color: exits 0 and has health line" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"healthy"* ]] || [[ "$output" == *"drift"* ]]
}

@test "roll-status fixture --no-color: includes GLOBAL CONVENTIONS section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"GLOBAL CONVENTIONS"* ]]
}

@test "roll-status fixture --no-color: includes AI CLIENTS section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"AI CLIENTS"* ]]
}

@test "roll-status fixture --no-color: includes PROJECT TEMPLATES section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"PROJECT TEMPLATES"* ]]
}

@test "roll-status fixture --no-color: includes THIS PROJECT section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"THIS PROJECT"* ]]
}

@test "roll-status fixture: --no-color suppresses ANSI escapes" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033['* ]]
}

@test "cmd_status dispatch: ROLL_UI=v2 routes to roll-status.py" {
  body=$(awk '/^cmd_status\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"roll-status.py"* ]]
}

@test "cmd_status dispatch: ROLL_UI=v1 routes to _legacy_status" {
  body=$(awk '/^cmd_status\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"_legacy_status"* ]]
}
