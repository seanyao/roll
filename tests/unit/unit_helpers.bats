#!/usr/bin/env bats
# Tests for tests/unit/helpers.bash — shared unit test infrastructure

HELPERS="${BATS_TEST_DIRNAME}/helpers.bash"

# ─── Structure ────────────────────────────────────────────────────────────────

@test "helpers.bash exists" {
  [ -f "$HELPERS" ]
}

@test "helpers.bash: ROLL_BIN points to bin/roll" {
  grep -qF 'bin/roll' "$HELPERS"
}

@test "helpers.bash: defines unit_setup" {
  grep -qE '^unit_setup\(\)' "$HELPERS"
}

@test "helpers.bash: defines unit_teardown" {
  grep -qE '^unit_teardown\(\)' "$HELPERS"
}

@test "helpers.bash: defines unit_setup_cd" {
  grep -qE '^unit_setup_cd\(\)' "$HELPERS"
}

@test "helpers.bash: defines unit_teardown_cd" {
  grep -qE '^unit_teardown_cd\(\)' "$HELPERS"
}

# ─── Behaviour: unit_setup / unit_teardown ────────────────────────────────────

@test "unit_setup: creates TEST_TMP directory" {
  load helpers
  unit_setup
  [ -d "$TEST_TMP" ]
  unit_teardown
}

@test "unit_setup: sets NO_COLOR=1" {
  load helpers
  unit_setup
  [ "${NO_COLOR:-}" = "1" ]
  unit_teardown
}

@test "unit_setup: sets TERM=dumb" {
  load helpers
  unit_setup
  [ "${TERM:-}" = "dumb" ]
  unit_teardown
}

@test "unit_teardown: removes TEST_TMP" {
  load helpers
  unit_setup
  local tmp="$TEST_TMP"
  unit_teardown
  [ ! -d "$tmp" ]
}

# ─── Behaviour: unit_setup_cd / unit_teardown_cd ──────────────────────────────

@test "unit_setup_cd: cds into TEST_TMP" {
  load helpers
  local orig="$PWD"
  unit_setup_cd
  [ "$PWD" = "$TEST_TMP" ]
  unit_teardown_cd
  cd "$orig"
}

@test "unit_teardown_cd: removes TEST_TMP and restores original dir" {
  load helpers
  local orig="$PWD"
  unit_setup_cd
  local tmp="$TEST_TMP"
  unit_teardown_cd
  cd "$orig"
  [ ! -d "$tmp" ]
  [ "$PWD" = "$orig" ]
}
