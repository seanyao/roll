#!/usr/bin/env bats
# FIX-123: _runs_append atomic write — .tmp files must not survive normal
# completion or interrupt, and stale .tmp files from dead PIDs must be
# cleaned on entry.

load helpers

setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# Extract _runs_append from the generated inner script so we can test it
# in isolation. _write_loop_runner_script writes to <runner>-inner.sh and
# _runs_append is the block between its definition and _inner_cleanup.
_extract_runs_append() {
  local inner="$1"
  sed -n '/^_runs_append() {/,/^_inner_cleanup()/p' "$inner" \
    | sed '$d'
}

@test "_runs_append: normal completion leaves no .tmp behind" {
  local inner_script="${TEST_TMP}/run-inner.sh"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24
  inner_script="${TEST_TMP}/run-inner.sh"

  # Set up env needed by _runs_append
  export CYCLE_ID="20260526-120000-12345"
  export CYCLE_START
  CYCLE_START=$(date -u +%s)
  export slug="test-proj-abc123"

  mkdir -p "${TEST_TMP}/shared/loop"
  export _SHARED_ROOT="${TEST_TMP}/shared"

  # Source just the _runs_append function
  local fn_file="${TEST_TMP}/fn.sh"
  _extract_runs_append "$inner_script" > "$fn_file"
  source "$fn_file"

  # Run _runs_append
  _runs_append "built" 3 '["US-TEST-001"]'

  # Verify the record was appended
  run grep -c '"run_id":"loop-20260526-120000"' "${_SHARED_ROOT}/loop/runs.jsonl"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]

  # Verify no .tmp files remain
  local tmp_count
  tmp_count=$(find "$(dirname "${_SHARED_ROOT}/loop/runs.jsonl")" -maxdepth 1 -name 'runs.jsonl.tmp.*' 2>/dev/null | wc -l)
  tmp_count=${tmp_count// /}
  [ "${tmp_count:-0}" -eq 0 ]
}

@test "_runs_append: cleans stale .tmp from dead PID on entry" {
  local inner_script="${TEST_TMP}/run-inner.sh"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24
  inner_script="${TEST_TMP}/run-inner.sh"

  export CYCLE_ID="20260526-130000-67890"
  CYCLE_START=$(date -u +%s)
  export slug="test-proj-def456"

  mkdir -p "${TEST_TMP}/shared/loop"
  export _SHARED_ROOT="${TEST_TMP}/shared"

  # Create a fake stale .tmp file with a PID that is guaranteed to be dead:
  # launch a subshell, capture its PID, wait for it to exit.
  bash -c 'exit 0' &
  local dead_pid=$!
  wait "$dead_pid" 2>/dev/null || true
  local stale_tmp="${_SHARED_ROOT}/loop/runs.jsonl.tmp.${dead_pid}"
  echo '{"stale":"data"}' > "$stale_tmp"

  local fn_file="${TEST_TMP}/fn.sh"
  _extract_runs_append "$inner_script" > "$fn_file"
  source "$fn_file"

  _runs_append "built" 1 '["US-TEST-002"]'

  # The stale .tmp should be gone (dead PID cleaned on entry)
  [ ! -f "$stale_tmp" ]
}

@test "_runs_append: does not clean .tmp from live PID" {
  local inner_script="${TEST_TMP}/run-inner.sh"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24
  inner_script="${TEST_TMP}/run-inner.sh"

  export CYCLE_ID="20260526-140000-11111"
  CYCLE_START=$(date -u +%s)
  export slug="test-proj-ghi789"

  mkdir -p "${TEST_TMP}/shared/loop"
  export _SHARED_ROOT="${TEST_TMP}/shared"

  # Use parent PID (the bats process) — must NOT be cleaned because it's alive.
  # Avoid $$ because _runs_append creates/cleans its own .tmp.$$ internally.
  local live_tmp="${_SHARED_ROOT}/loop/runs.jsonl.tmp.${PPID}"
  echo '{"live":"data"}' > "$live_tmp"

  local fn_file="${TEST_TMP}/fn.sh"
  _extract_runs_append "$inner_script" > "$fn_file"
  source "$fn_file"

  _runs_append "built" 1 '["US-TEST-003"]'

  # The live .tmp should still exist (PID is alive)
  [ -f "$live_tmp" ]
}
