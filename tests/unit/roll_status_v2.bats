#!/usr/bin/env bats
# Unit tests for lib/roll-status.py + cmd_status dispatch (US-VIEW-004)

LIB="${BATS_TEST_DIRNAME}/../../lib"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

@test "roll-status --demo --no-color: exits 0 and has health line" {
  run python3 "${LIB}/roll-status.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"healthy"* ]] || [[ "$output" == *"drift"* ]]
}

@test "roll-status --demo --no-color: includes GLOBAL CONVENTIONS section" {
  run python3 "${LIB}/roll-status.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"GLOBAL CONVENTIONS"* ]]
}

@test "roll-status --demo --no-color: includes AI CLIENTS section" {
  run python3 "${LIB}/roll-status.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"AI CLIENTS"* ]]
}

@test "roll-status --demo --no-color: includes PROJECT TEMPLATES section" {
  run python3 "${LIB}/roll-status.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"PROJECT TEMPLATES"* ]]
}

@test "roll-status --demo --no-color: includes THIS PROJECT section" {
  run python3 "${LIB}/roll-status.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"THIS PROJECT"* ]]
}

@test "roll-status --demo: --no-color suppresses ANSI escapes" {
  run python3 "${LIB}/roll-status.py" --demo --no-color
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
