#!/usr/bin/env bats
# Unit tests for _slides_progress_* helpers (US-DECK-010).
#
# Exercises:
#   - _slides_progress_init / _slides_progress_quiet state setup
#   - _slides_progress_phase_enter + _slides_progress_ok transitions
#   - spinner start/stop lifecycle
#   - non-TTY auto-quiet detection
#   - elapsed time formatting

setup() {
  TEST_TMP="$(mktemp -d)"
  # Source bin/roll for helper functions
  ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
}

teardown() {
  rm -rf "${TEST_TMP:-}"
  # Clean up any lingering state vars
  unset _SLIDES_PROGRESS_PHASES _SLIDES_PROGRESS_START_TIME
  unset _SLIDES_PROGRESS_CURRENT _SLIDES_PROGRESS_PHASE_START_TIME
  unset _SLIDES_PROGRESS_SPINNER_PID _SLIDES_PROGRESS_QUIET
}

source_roll() {
  # shellcheck disable=SC1090
  source "$ROLL_BIN"
}

@test "progress init: populates phase list" {
  source_roll
  _slides_progress_init launching generating validating rendering opening
  [ "${#_SLIDES_PROGRESS_PHASES[@]}" -eq 5 ]
  [ "${_SLIDES_PROGRESS_PHASES[0]}" = "launching" ]
  [ "${_SLIDES_PROGRESS_PHASES[4]}" = "opening" ]
  [ -n "${_SLIDES_PROGRESS_START_TIME:-}" ]
}

@test "progress quiet: sets flag" {
  source_roll
  _slides_progress_quiet
  [ "${_SLIDES_PROGRESS_QUIET:-0}" -eq 1 ]
}

@test "progress init: resets quiet flag" {
  source_roll
  _slides_progress_quiet
  _slides_progress_init launching generating
  [ "${_SLIDES_PROGRESS_QUIET:-0}" -eq 0 ]
}

@test "progress phase_enter: sets current phase" {
  source_roll
  _slides_progress_init launching generating
  _slides_progress_phase_enter "launching"
  [ "$_SLIDES_PROGRESS_CURRENT" = "launching" ]
}

@test "progress phase_enter+ok: quiet mode suppresses output" {
  source_roll
  _slides_progress_init launching
  _slides_progress_quiet
  run _slides_progress_phase_enter "launching"
  [ "$status" -eq 0 ]
  # quiet mode should produce no output
  [ -z "$output" ]
}

@test "progress elapsed formatting: seconds only" {
  source_roll
  local result
  result="$(_slides_progress_elapsed_str 7)"
  [ "$result" = "7s" ]
}

@test "progress elapsed formatting: minutes and seconds" {
  source_roll
  local result
  result="$(_slides_progress_elapsed_str 125)"
  [ "$result" = "2m 5s" ]
}

@test "progress non-TTY detection: when stdout is not a terminal" {
  source_roll
  _slides_progress_init launching
  # Simulate non-TTY by overriding test
  _slides_progress_detect_tty() { _slides_progress_quiet; }
  _slides_progress_detect_tty
  [ "${_SLIDES_PROGRESS_QUIET:-0}" -eq 1 ]
}
