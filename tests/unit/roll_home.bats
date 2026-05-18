#!/usr/bin/env bats
# Unit tests for lib/roll-home.py + _home dispatch (US-VIEW-002)

LIB="${BATS_TEST_DIRNAME}/../../lib"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

@test "roll-home --demo --no-color: exits 0 and has identity line" {
  run python3 "${LIB}/roll-home.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll ·"* ]]
}

@test "roll-home --demo --no-color: includes THREE LAYERS section" {
  run python3 "${LIB}/roll-home.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"THREE LAYERS"* ]]
}

@test "roll-home --demo --no-color: includes FOUR DEFENSES section" {
  run python3 "${LIB}/roll-home.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"FOUR DEFENSES"* ]]
}

@test "roll-home --demo --no-color: includes PIPELINE section" {
  run python3 "${LIB}/roll-home.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"PIPELINE"* ]]
}

@test "roll-home --demo --no-color: includes NEED YOU section" {
  run python3 "${LIB}/roll-home.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"NEED YOU"* ]]
}

@test "roll-home --demo --no-color: includes quick-nav footer" {
  run python3 "${LIB}/roll-home.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll loop"* ]]
  [[ "$output" == *"roll --help"* ]]
}

@test "roll-home --demo: --no-color suppresses ANSI escapes" {
  run python3 "${LIB}/roll-home.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033['* ]]
}

@test "_home dispatch: ROLL_UI=v2 routes to roll-home.py" {
  body=$(awk '/^_home\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"roll-home.py"* ]]
}

@test "_home dispatch: ROLL_UI=v1 routes to _legacy_home" {
  body=$(awk '/^_home\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"_legacy_home"* ]]
}
