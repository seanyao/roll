#!/usr/bin/env bats
# Unit tests for: US-CLI-004 — hide internal hooks from roll loop --help
#
# AC: roll loop --help Usage 行不含 notify / enforce-tcr / precheck-ci
# AC: dispatch case 不变,3 个 subcommand 仍可被 SKILL 正常调用

load helpers

setup() {
  unit_setup
}

# ── AC: Usage line excludes internal hooks ─────────────────────────────────

@test "roll loop --help: Usage line does not contain notify" {
  run bash "$ROLL_BIN" loop --help
  ! grep -q 'Usage:.*notify' <<< "$output"
}

@test "roll loop --help: Usage line does not contain enforce-tcr" {
  run bash "$ROLL_BIN" loop --help
  ! grep -q 'Usage:.*enforce-tcr' <<< "$output"
}

@test "roll loop --help: Usage line does not contain precheck-ci" {
  run bash "$ROLL_BIN" loop --help
  ! grep -q 'Usage:.*precheck-ci' <<< "$output"
}

# ── AC: user-facing commands still appear in help ────────────────────────────

@test "roll loop --help: user-facing commands still appear" {
  run bash "$ROLL_BIN" loop --help
  grep -qE '^\s+on\s' <<< "$output"
  grep -qE '^\s+off\s' <<< "$output"
  grep -qE '^\s+now\s' <<< "$output"
  grep -qE '^\s+status\s' <<< "$output"
  grep -qE '^\s+runs\s' <<< "$output"
}

# ── AC: dispatch unchanged — internal hooks still callable ──────────────────

@test "roll loop notify: dispatch still works (subcommand functional)" {
  run bash "$ROLL_BIN" loop notify
  [ "$status" -eq 0 ]
}

@test "roll loop enforce-tcr: dispatch still works (subcommand functional)" {
  run bash "$ROLL_BIN" loop enforce-tcr "US-TEST-001" ""
  [ "$status" -eq 0 ]
}

@test "roll loop precheck-ci: dispatch still works (subcommand functional)" {
  run bash "$ROLL_BIN" loop precheck-ci
  [ "$status" -eq 0 ]
}
