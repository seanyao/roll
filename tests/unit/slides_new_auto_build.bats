#!/usr/bin/env bats
# US-DECK-009: auto-build after `roll slides new`.

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

@test "slides new --no-build: accepted as valid option" {
  # Just verify the option is parsed, not rejected as unknown
  run bash "$ROLL_BIN" slides new --no-build 2>&1 || true
  # Should fail on missing topic, not on --no-build being unknown
  [[ "$output" != *"Unknown option"* ]]
}

@test "slides new --no-build: appears in help" {
  run bash "$ROLL_BIN" slides new --help
  [[ "$output" == *"--no-build"* ]]
}

@test "slides help: lists --no-build in options" {
  run bash "$ROLL_BIN" slides --help
  [[ "$output" == *"--no-build"* ]]
}

@test "slides new: function sources with no_build variable" {
  run bash -c "source '$ROLL_BIN' 2>/dev/null; type cmd_slides_new"
  [[ "$output" == *"no_build"* ]]
}
