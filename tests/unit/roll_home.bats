#!/usr/bin/env bats
# Unit tests for lib/roll-home.py (US-VIEW-002)

LIB="${BATS_TEST_DIRNAME}/../../lib"

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
