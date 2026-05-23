#!/usr/bin/env bats
# US-VIEW-019: slowest phase summary in `roll loop runs` and the new
# `roll loop runs --detail <cycle_id>` subcommand.
# bats tier: fast

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

@test "_loop_runs_slowest_phase abbreviates claude_invoke to 'claude'" {
  run _loop_runs_slowest_phase '{"phases":{"startup":1,"claude_invoke":120}}'
  [ "$status" -eq 0 ]
  [[ "$output" == "claude "* ]]
}

@test "_loop_runs_slowest_phase abbreviates publish_wait_merge to 'pr-wait'" {
  run _loop_runs_slowest_phase '{"phases":{"startup":1,"publish_wait_merge":300}}'
  [ "$status" -eq 0 ]
  [[ "$output" == "pr-wait "* ]]
}

@test "_loop_runs_slowest_phase abbreviates publish_push to 'publish'" {
  run _loop_runs_slowest_phase '{"phases":{"publish_push":50,"cleanup":1}}'
  [ "$status" -eq 0 ]
  [[ "$output" == "publish "* ]]
}

@test "_loop_runs_slowest_phase abbreviates worktree_setup to 'worktree'" {
  run _loop_runs_slowest_phase '{"phases":{"worktree_setup":20,"startup":1}}'
  [ "$status" -eq 0 ]
  [[ "$output" == "worktree "* ]]
}

@test "_loop_runs_slowest_phase shows percentage" {
  run _loop_runs_slowest_phase '{"phases":{"startup":1,"claude_invoke":99}}'
  [[ "$output" == *"99%"* ]]
}

@test "_loop_runs_slowest_phase empty when no phases field" {
  run _loop_runs_slowest_phase '{}'
  [ -z "$output" ]
}

@test "_loop_runs_slowest_phase empty when phases is empty object" {
  run _loop_runs_slowest_phase '{"phases":{}}'
  [ -z "$output" ]
}

@test "_loop_runs_detail prints breakdown for cycle found in runs.jsonl" {
  local runs="${TEST_TMP}/runs.jsonl"
  cat > "$runs" <<'JSON'
{"ts":"2026-05-23T11:00:00Z","project":"p","run_id":"loop-1","status":"built","cycle_id":"cy-1","built":["US"],"tcr_count":2,"duration_sec":125,"phases":{"startup":1,"claude_invoke":115,"cleanup":3}}
JSON
  _LOOP_RUNS="$runs"
  run _loop_runs_detail "cy-1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"claude_invoke"* ]]
  [[ "$output" == *"Total"* ]]
}

@test "_loop_runs_detail prints phases in duration-desc order" {
  local runs="${TEST_TMP}/runs.jsonl"
  cat > "$runs" <<'JSON'
{"cycle_id":"cy-2","phases":{"startup":2,"claude_invoke":100,"preflight":50}}
JSON
  _LOOP_RUNS="$runs"
  run _loop_runs_detail "cy-2"
  [ "$status" -eq 0 ]
  # First data row should be claude_invoke (largest)
  local first
  first=$(echo "$output" | grep -E '^  [a-z_]+' | head -1 | awk '{print $1}')
  [ "$first" = "claude_invoke" ]
}

@test "_loop_runs_detail returns non-zero when cycle id missing" {
  local runs="${TEST_TMP}/runs.jsonl"
  echo '{"cycle_id":"other"}' > "$runs"
  _LOOP_RUNS="$runs"
  run _loop_runs_detail "missing"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not found"* ]]
}

@test "_loop_runs_detail handles legacy cycle without phases" {
  local runs="${TEST_TMP}/runs.jsonl"
  echo '{"cycle_id":"legacy","status":"built"}' > "$runs"
  _LOOP_RUNS="$runs"
  run _loop_runs_detail "legacy"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no phases"* ]] || [[ "$output" == *"pre-US-LOOP-008"* ]]
}

@test "_loop_runs accepts --detail flag and routes to detail handler" {
  local runs="${TEST_TMP}/runs.jsonl"
  cat > "$runs" <<'JSON'
{"cycle_id":"abc","phases":{"startup":1,"claude_invoke":10}}
JSON
  _LOOP_RUNS="$runs"
  run _loop_runs --detail abc
  [ "$status" -eq 0 ]
  [[ "$output" == *"Phase Breakdown"* ]]
}

@test "_loop_runs accepts --detail=<id> form" {
  local runs="${TEST_TMP}/runs.jsonl"
  cat > "$runs" <<'JSON'
{"cycle_id":"abc","phases":{"startup":1,"claude_invoke":10}}
JSON
  _LOOP_RUNS="$runs"
  run _loop_runs --detail=abc
  [ "$status" -eq 0 ]
  [[ "$output" == *"Phase Breakdown"* ]]
}
