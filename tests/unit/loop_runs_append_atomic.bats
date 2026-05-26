#!/usr/bin/env bats
# FIX-123: runs.jsonl atomic write leaves no .tmp orphans.
#
# _loop_backfill_merged creates a temp file for atomic rewrite.
# If interrupted, the .tmp file persists. This suite verifies:
# 1. EXIT trap cleans up the temp file on interrupt
# 2. Stale .tmp files from dead pids are cleaned on next write

load helpers

setup() {
  unit_setup
  _runs="${TEST_TMP}/runs.jsonl"
  # FIX-065 sandbox: override default to keep writes inside TEST_TMP
  export _SHARED_ROOT="${TEST_TMP}/shared"
  mkdir -p "${_SHARED_ROOT}/loop"
  # Default runs path used by _loop_cleanup_stale_runs_tmp
  _LOOP_RUNS="${_SHARED_ROOT}/loop/runs.jsonl"
}
teardown() { unit_teardown; }

@test "FIX-123: _loop_cleanup_stale_runs_tmp cleans .tmp from dead pid" {
  # Create a .tmp file with a pid that cannot possibly be alive
  local dead_pid=99999
  while kill -0 "$dead_pid" 2>/dev/null; do
    dead_pid=$(( dead_pid + 1 ))
  done
  local stale_tmp="${_SHARED_ROOT}/loop/runs.jsonl.tmp.${dead_pid}"
  echo "orphan data" > "$stale_tmp"
  [ -f "$stale_tmp" ]

  run _loop_cleanup_stale_runs_tmp
  [ "$status" -eq 0 ]
  [ ! -f "$stale_tmp" ]
}

@test "FIX-123: _loop_cleanup_stale_runs_tmp preserves .tmp from live pid" {
  # Create a .tmp file with $$ (current process — definitely alive)
  local live_tmp="${_SHARED_ROOT}/loop/runs.jsonl.tmp.$$"
  echo "live data" > "$live_tmp"
  [ -f "$live_tmp" ]

  run _loop_cleanup_stale_runs_tmp
  [ "$status" -eq 0 ]
  [ -f "$live_tmp" ]
}

@test "FIX-123: _loop_cleanup_stale_runs_tmp no-op when no .tmp files" {
  run _loop_cleanup_stale_runs_tmp
  [ "$status" -eq 0 ]
}

@test "FIX-123: _loop_backfill_merged sets EXIT trap for temp file" {
  # Verify the function body contains a trap to clean its temp file
  local func_body
  func_body=$(awk '/^_loop_backfill_merged\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  grep -qE 'trap.*rm.*-f.*\$\{?tmp\}?' <<< "$func_body"
}

@test "FIX-123: _loop_backfill_merged calls _loop_cleanup_stale_runs_tmp" {
  local func_body
  func_body=$(awk '/^_loop_backfill_merged\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  grep -qE '_loop_cleanup_stale_runs_tmp' <<< "$func_body"
}

@test "FIX-123: _runs_append template calls _loop_cleanup_stale_runs_tmp" {
  # _runs_append is inside the inner runner heredoc — verify the template
  # includes the cleanup call by searching the 50 lines after the function def
  local start
  start=$(grep -n '^_runs_append()' "$ROLL_BIN" | head -1 | cut -d: -f1)
  [ -n "$start" ]
  sed -n "${start},$((start + 50))p" "$ROLL_BIN" | grep -qE '_loop_cleanup_stale_runs_tmp'
}
