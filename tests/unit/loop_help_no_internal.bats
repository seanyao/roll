#!/usr/bin/env bats
# Tests for US-CLI-004: hide internal subcommands from `roll loop --help`
#
# notify / enforce-tcr / precheck-ci are SKILL-internal hooks, not user
# commands. They must not appear in the Usage line or help table.

load helpers

setup()   { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ── Usage line ───────────────────────────────────────────────────────────────

@test "roll loop --help Usage line excludes notify" {
  run bash "$ROLL_BIN" loop --help
  ! grep -q 'Usage:.*notify' <<< "$output"
}

@test "roll loop --help Usage line excludes enforce-tcr" {
  run bash "$ROLL_BIN" loop --help
  ! grep -q 'Usage:.*enforce-tcr' <<< "$output"
}

@test "roll loop --help Usage line excludes precheck-ci" {
  run bash "$ROLL_BIN" loop --help
  ! grep -q 'Usage:.*precheck-ci' <<< "$output"
}

@test "roll loop --help Usage line still includes user subcommands" {
  run bash "$ROLL_BIN" loop --help
  grep -qE '^\s+on\s' <<< "$output"
  grep -qE '^\s+off\s' <<< "$output"
  grep -qE '^\s+status\s' <<< "$output"
  grep -qE '^\s+runs\s' <<< "$output"
}

# ── Help table: internal section exists ─────────────────────────────────────

@test "roll loop --help internal section exists" {
  run bash "$ROLL_BIN" loop --help
  grep -q 'Internal (called by roll-loop SKILL)' <<< "$output"
}

@test "roll loop --help internal section contains notify" {
  run bash "$ROLL_BIN" loop --help
  grep -q 'notify' <<< "$output"
}

@test "roll loop --help internal section contains enforce-tcr" {
  run bash "$ROLL_BIN" loop --help
  grep -q 'enforce-tcr' <<< "$output"
}

@test "roll loop --help internal section contains precheck-ci" {
  run bash "$ROLL_BIN" loop --help
  grep -q 'precheck-ci' <<< "$output"
}

# ── Dispatch still works ─────────────────────────────────────────────────────

@test "dispatch case for notify still present" {
  run grep 'notify).*_notify' "$ROLL_BIN"
  [ "$status" -eq 0 ]
}

@test "dispatch case for enforce-tcr still present" {
  run grep 'enforce-tcr).*_loop_enforce_tcr' "$ROLL_BIN"
  [ "$status" -eq 0 ]
}

@test "dispatch case for precheck-ci still present" {
  run grep 'precheck-ci).*_loop_precheck_ci' "$ROLL_BIN"
  [ "$status" -eq 0 ]
}
