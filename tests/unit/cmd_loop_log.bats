#!/usr/bin/env bats
# Tests for roll loop log — per-cycle log viewer (US-LOOP-016)

load helpers

setup() {
  unit_setup_cd
  mkdir -p "${TEST_TMP}/.roll/cycle-logs"
}
teardown() { unit_teardown_cd; }

# ── Helpers ──────────────────────────────────────────────────────────────────

# Write a fake cycle log file. $1=cycle_id, $2=content.
_mklog() {
  echo "$2" > "${TEST_TMP}/.roll/cycle-logs/${1}.log"
}

# ── Dispatch ─────────────────────────────────────────────────────────────────

@test "cmd_loop routes 'log' to _loop_log" {
  grep -qE 'log\)[[:space:]]+shift; _loop_log' "$ROLL_BIN"
}

@test "cmd_loop usage line lists 'log'" {
  grep -qE 'Usage: roll loop .*log' "$ROLL_BIN"
}

@test "cmd_loop help text describes 'log'" {
  grep -qE 'log \[id\].*Show per-cycle log' "$ROLL_BIN"
}

# ── Empty / missing directory ────────────────────────────────────────────────

@test "_loop_log: friendly message when cycle-logs dir missing" {
  rmdir "${TEST_TMP}/.roll/cycle-logs"
  run _loop_log
  [ "$status" -eq 0 ]
  [[ "$output" == *"No cycle logs"* ]]
}

@test "_loop_log: friendly message when cycle-logs dir empty" {
  run _loop_log
  [ "$status" -eq 0 ]
  [[ "$output" == *"No cycle logs"* ]]
}

# ── No argument: latest by mtime ─────────────────────────────────────────────

@test "_loop_log: shows latest log content with header" {
  _mklog "20260525-161800-40061" "first log content"
  _mklog "20260525-171800-50062" "second log content"

  run _loop_log
  [ "$status" -eq 0 ]
  # Should show the later file (50062)
  [[ "$output" == *"# cycle 20260525-171800-50062"* ]]
  [[ "$output" == *"second log content"* ]]
  [[ "$output" != *"first log content"* ]]
}

# ── Exact cycle-id match ─────────────────────────────────────────────────────

@test "_loop_log <exact-id>: shows matching log" {
  _mklog "20260525-161800-40061" "exact match content"

  run _loop_log "20260525-161800-40061"
  [ "$status" -eq 0 ]
  [[ "$output" == *"# cycle 20260525-161800-40061"* ]]
  [[ "$output" == *"exact match content"* ]]
}

# ── Prefix match (unique) ────────────────────────────────────────────────────

@test "_loop_log <prefix>: unique prefix shows matching log" {
  _mklog "20260525-161800-40061" "prefix content"
  _mklog "20260525-171800-50062" "other content"

  run _loop_log "20260525-16"
  [ "$status" -eq 0 ]
  [[ "$output" == *"# cycle 20260525-161800-40061"* ]]
  [[ "$output" == *"prefix content"* ]]
  [[ "$output" != *"other content"* ]]
}

# ── Prefix match (ambiguous) ─────────────────────────────────────────────────

@test "_loop_log <prefix>: ambiguous prefix lists candidates and exits 1" {
  _mklog "20260525-161800-40061" "content a"
  _mklog "20260525-161900-50062" "content b"

  run _loop_log "20260525-16"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Ambiguous prefix"* ]]
  [[ "$output" == *"20260525-161800-40061"* ]]
  [[ "$output" == *"20260525-161900-50062"* ]]
}

# ── Non-matching query ───────────────────────────────────────────────────────

@test "_loop_log <query>: non-matching prints message and exits 1" {
  _mklog "20260525-161800-40061" "only one"

  run _loop_log "nosuch"
  [ "$status" -eq 1 ]
  [[ "$output" == *"No cycle log matching"* ]]
}
