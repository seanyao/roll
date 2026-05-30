#!/usr/bin/env bats
# US-LOOP-020: `roll loop runs --all` aggregates each project's local
# .roll/loop/runs.jsonl, merged and time-sorted. Uses ROLL_LOOP_RUNS_ALL_DIRS
# to list fixture runtime dirs so the test needs no launchd registry.

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
  command -v jq >/dev/null 2>&1 || skip "jq required"

  PROJ_A="${BATS_TMPDIR}/agg-A-${RANDOM}"
  PROJ_B="${BATS_TMPDIR}/agg-B-${RANDOM}"
  mkdir -p "${PROJ_A}/.roll/loop" "${PROJ_B}/.roll/loop"

  # Interleave timestamps across the two projects so a correct merge must sort.
  printf '{"project":"projA","run_id":"loop-A1","ts":"2026-05-30T01:00:00Z","status":"built","built":["US-A-001"],"tcr_count":1,"duration_sec":60}\n' \
    > "${PROJ_A}/.roll/loop/runs.jsonl"
  printf '{"project":"projA","run_id":"loop-A2","ts":"2026-05-30T03:00:00Z","status":"idle","built":[],"tcr_count":0,"duration_sec":5}\n' \
    >> "${PROJ_A}/.roll/loop/runs.jsonl"
  printf '{"project":"projB","run_id":"loop-B1","ts":"2026-05-30T02:00:00Z","status":"built","built":["US-B-001"],"tcr_count":2,"duration_sec":120}\n' \
    > "${PROJ_B}/.roll/loop/runs.jsonl"

  export ROLL_LOOP_RUNS_ALL_DIRS="${PROJ_A}/.roll/loop:${PROJ_B}/.roll/loop"
  export TZ=UTC
  export NO_COLOR=1
}

teardown() {
  rm -rf "${PROJ_A}" "${PROJ_B}" 2>/dev/null || true
  unset ROLL_LOOP_RUNS_ALL_DIRS
}

@test "_loop_runs_aggregate_all merges both projects' rows" {
  run _loop_runs_aggregate_all
  [ "$status" -eq 0 ]
  [[ "$output" == *"loop-A1"* ]]
  [[ "$output" == *"loop-A2"* ]]
  [[ "$output" == *"loop-B1"* ]]
}

@test "_loop_runs_aggregate_all sorts rows oldest -> newest by ts" {
  run _loop_runs_aggregate_all
  [ "$status" -eq 0 ]
  # Expected ts order: A1(01:00) B1(02:00) A2(03:00)
  local order; order=$(printf '%s\n' "$output" | jq -r '.run_id')
  local expected
  expected=$(printf '%s\n' "loop-A1" "loop-B1" "loop-A2")
  [ "$order" = "$expected" ]
}

@test "roll loop runs --all renders entries from both fixture projects" {
  run _loop_runs --all
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-A-001"* ]]
  [[ "$output" == *"US-B-001"* ]]
}

@test "roll loop runs --all newest-first: 03:00 row appears before 01:00 row" {
  run _loop_runs --all
  [ "$status" -eq 0 ]
  # Rendered rows show local time + [project]; assert newest-first ordering.
  local newest_line oldest_line
  newest_line=$(printf '%s\n' "$output" | grep -n "03:00" | head -1 | cut -d: -f1 || true)
  oldest_line=$(printf '%s\n' "$output" | grep -n "01:00" | head -1 | cut -d: -f1 || true)
  [ -n "$newest_line" ] && [ -n "$oldest_line" ]
  [ "$newest_line" -lt "$oldest_line" ]
}
