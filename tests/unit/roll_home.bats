#!/usr/bin/env bats
# Unit tests for lib/roll-home.py + _home dispatch (US-VIEW-002)

LIB="${BATS_TEST_DIRNAME}/../../lib"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

# FIX-076: fixture data is gated on the ROLL_RENDER_FIXTURE env var; user-facing
# CLI no longer exposes --demo. Tests opt into fixture rendering explicitly.
_run_fixture() {
  ROLL_RENDER_FIXTURE=1 run python3 "${LIB}/roll-home.py" --no-color "$@"
}

@test "roll-home fixture --no-color: exits 0 and has identity line" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll ·"* ]]
}

@test "roll-home fixture --no-color: includes THREE LAYERS section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"THREE LAYERS"* ]]
}

@test "roll-home fixture --no-color: includes FOUR DEFENSES section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"FOUR DEFENSES"* ]]
}

@test "roll-home fixture --no-color: includes PIPELINE section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"PIPELINE"* ]]
}

@test "roll-home fixture --no-color: includes NEED YOU section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"NEED YOU"* ]]
}

@test "roll-home fixture --no-color: includes quick-nav footer" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll loop"* ]]
  [[ "$output" == *"roll --help"* ]]
}

@test "roll-home fixture: --no-color suppresses ANSI escapes" {
  _run_fixture
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
