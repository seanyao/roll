#!/usr/bin/env bats
# US-LOOP-007: cycle phase tracing helpers (_phase_begin / _phase_end /
# CURRENT_PHASE) and _loop_event rendering for phase_* stages.
# bats tier: fast

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

@test "_loop_event phase_start prints emoji and phase name" {
  run _loop_event phase_start startup "" ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"🚀"* ]]
  [[ "$output" == *"startup"* ]]
}

@test "_loop_event phase_start uses worktree emoji for worktree_setup" {
  run _loop_event phase_start worktree_setup "" ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"🌳"* ]]
  [[ "$output" == *"worktree_setup"* ]]
}

@test "_loop_event phase_start uses agent emoji for agent_invoke" {
  run _loop_event phase_start agent_invoke "" ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"🤖"* ]]
}

@test "_loop_event phase_tick prints elapsed marker" {
  run _loop_event phase_tick agent_invoke "300s elapsed" ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"⏱"* ]]
  [[ "$output" == *"300s elapsed"* ]]
}

@test "_loop_event phase_end ok uses checkmark" {
  run _loop_event phase_end cleanup "0.6s" ok
  [ "$status" -eq 0 ]
  [[ "$output" == *"✓"* ]]
  [[ "$output" == *"0.6s"* ]]
}

@test "_loop_event phase_end fail uses cross" {
  run _loop_event phase_end publish_wait_merge "600s" fail
  [ "$status" -eq 0 ]
  [[ "$output" == *"✗"* ]]
  [[ "$output" == *"600s"* ]]
}

@test "_loop_event non-phase stage keeps legacy tab-separated format" {
  run _loop_event cycle_start "20260523-1" "" ""
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\t'cycle_start$'\t'* ]]
}

@test "phase_* events are appended to events ndjson alongside stdout rendering" {
  _loop_event phase_start startup "" "" >/dev/null
  _loop_event phase_end startup "0.4s" ok >/dev/null
  local slug; slug=$(_project_slug)
  local evfile="${_SHARED_ROOT}/loop/events-${slug}.ndjson"
  [ -f "$evfile" ]
  grep -q '"stage":"phase_start"' "$evfile"
  grep -q '"stage":"phase_end"' "$evfile"
}

@test "inner runner template includes all 7 phase boundaries" {
  local runner_dir="${TEST_TMP}/runner"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 10 18
  local inner="${runner_dir}/run-inner.sh"
  [ -f "$inner" ]
  grep -q '_phase_begin startup' "$inner"
  grep -q '_phase_begin preflight' "$inner"
  grep -q '_phase_begin worktree_setup' "$inner"
  grep -q '_phase_begin agent_invoke' "$inner"
  grep -q '_phase_begin publish_push' "$inner"
  grep -q '_phase_begin publish_wait_merge' "$inner"
  grep -q '_phase_begin cleanup' "$inner"
}

@test "inner runner template heartbeat emits phase_tick when CURRENT_PHASE set" {
  local runner_dir="${TEST_TMP}/runner2"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 10 18
  grep -q 'phase_tick "\$CURRENT_PHASE"' "${runner_dir}/run-inner.sh"
}

@test "inner runner template _inner_cleanup auto-closes CURRENT_PHASE" {
  local runner_dir="${TEST_TMP}/runner3"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 10 18
  grep -q 'CURRENT_PHASE:-' "${runner_dir}/run-inner.sh"
}

@test "_loop_wait_pr_merge polling loop emits phase_tick publish_wait_merge" {
  grep -q 'phase_tick publish_wait_merge' "$ROLL_BIN"
}
