#!/usr/bin/env bats
# US-LOOP-008: phase breakdown panel + runs.jsonl phases field.
# bats tier: fast

load helpers

setup() {
  unit_setup
  local runner_dir="${TEST_TMP}/runner"
  mkdir -p "$runner_dir"
  _write_loop_runner_script "${runner_dir}/run.sh" "${TEST_TMP}" "echo claude" "${runner_dir}/log.txt" 10 18
  INNER_SCRIPT="${runner_dir}/run-inner.sh"
  # Extract just the function definitions and the helper variables we need
  # from the generated inner script, so we can invoke them without firing
  # the full cycle (which would try to fetch origin, launch claude, etc.).
  awk '
    /^_PHASE_NAMES_DONE=/ { print; next }
    /^_phase_begin\(\)/   { in_fn=1 }
    /^_phase_end\(\)/     { in_fn=1 }
    /^_phases_to_json\(\)/ { in_fn=1 }
    /^_print_phase_breakdown\(\)/ { in_fn=1 }
    /^_runs_append\(\)/   { in_fn=1 }
    in_fn { print }
    /^}/ { if (in_fn) { in_fn=0 } }
  ' "$INNER_SCRIPT" > "${TEST_TMP}/helpers.sh"
  # shellcheck disable=SC1091
  source "${TEST_TMP}/helpers.sh"
}
teardown() { unit_teardown; }

@test "_phases_to_json returns {} when no phases ran" {
  _PHASE_NAMES_DONE=""
  run _phases_to_json
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "_phases_to_json builds object from completed phases" {
  _PHASE_NAMES_DONE=" startup preflight worktree_setup"
  _PHASE_DUR_startup=0
  _PHASE_DUR_preflight=3
  _PHASE_DUR_worktree_setup=5
  run _phases_to_json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.startup == 0 and .preflight == 3 and .worktree_setup == 5'
}

@test "_print_phase_breakdown sorts phases by duration desc" {
  _PHASE_NAMES_DONE=" startup preflight claude_invoke cleanup"
  _PHASE_DUR_startup=1
  _PHASE_DUR_preflight=3
  _PHASE_DUR_claude_invoke=120
  _PHASE_DUR_cleanup=1
  CYCLE_ID="test-cycle-1"
  run _print_phase_breakdown
  [ "$status" -eq 0 ]
  # First non-header phase row should be claude_invoke (largest)
  local first_phase
  first_phase=$(echo "$output" | grep -E '^\s{2}[a-z_]+' | head -1 | awk '{print $1}')
  [ "$first_phase" = "claude_invoke" ]
  [[ "$output" == *"Total"* ]]
}

@test "_print_phase_breakdown is silent when no phases ran" {
  _PHASE_NAMES_DONE=""
  run _print_phase_breakdown
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_runs_append accepts phases_json 4th arg and writes to runs.jsonl" {
  CYCLE_ID="20260523-100000-1"
  CYCLE_START=$(date +%s)
  local dst="${_SHARED_ROOT}/loop/runs.jsonl"
  _runs_append "done" 2 '["US-LOOP-008"]' '{"startup":1,"claude_invoke":120}'
  [ -f "$dst" ]
  jq -e '.phases.startup == 1 and .phases.claude_invoke == 120' "$dst"
  jq -e '.status == "done" and .built[0] == "US-LOOP-008"' "$dst"
}

@test "_runs_append defaults phases to {} when arg omitted" {
  CYCLE_ID="20260523-100001-1"
  CYCLE_START=$(date +%s)
  local dst="${_SHARED_ROOT}/loop/runs.jsonl"
  _runs_append "idle" 0 "[]"
  jq -e '.phases == {}' "$dst"
}

@test "inner script template wires _phases_to_json into final _runs_append" {
  grep -q '_phases_for_runs=$(_phases_to_json' "$INNER_SCRIPT"
  grep -q '_runs_append "$_cycle_status" "$_cycle_tcr" "$_cycle_built" "$_phases_for_runs"' "$INNER_SCRIPT"
}

@test "inner script template adds phases field to runs.jsonl jq invocation" {
  grep -q "phases:\\\$phases" "$INNER_SCRIPT"
}

@test "inner script template prints phase breakdown before runs.jsonl write" {
  awk '/_print_phase_breakdown/{p=NR} /_runs_append.*_phases_for_runs/{r=NR} END{ exit !(p>0 && r>p) }' "$INNER_SCRIPT"
}
