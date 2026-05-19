#!/usr/bin/env bats
# Unit tests for lib/roll-help.py + _help dispatch (US-VIEW-003)

LIB="${BATS_TEST_DIRNAME}/../../lib"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

@test "roll-help --demo --no-color: exits 0 and has wordmark" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll ·"* ]]
}

@test "roll-help --demo --no-color: includes AUTONOMY section" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"AUTONOMY"* ]]
}

@test "roll-help --demo --no-color: includes PROJECT section" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"PROJECT"* ]]
}

@test "roll-help --demo --no-color: includes MACHINE section" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"MACHINE"* ]]
}

@test "roll-help --demo --no-color: loop command has star highlight" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"★"* ]]
}

@test "roll-help --demo --no-color: includes examples block" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll loop"* ]]
  [[ "$output" == *"roll brief"* ]]
}

@test "roll-help --demo: --no-color suppresses ANSI escapes" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033['* ]]
}

@test "_help dispatch: ROLL_UI=v2 routes to roll-help.py" {
  body=$(awk '/^_help\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"roll-help.py"* ]]
}

@test "_help dispatch: ROLL_UI=v1 routes to _legacy_help" {
  body=$(awk '/^_help\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"_legacy_help"* ]]
}

# FIX-064: init's help description must reflect what cmd_init actually creates
# (.roll/features/), not the pre-2.0 docs/ directory.
@test "roll-help v2: init description shows .roll/features/ not docs/" {
  run python3 "${LIB}/roll-help.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *".roll/features/"* ]]
  [[ "$output" != *"+ docs/"* ]]
}
