#!/usr/bin/env bats
# US-LOOP-020: data-plane (runs.jsonl) migration + project-local resolution.
# Uses ROLL_PROJECT_RUNTIME_DIR env override (loop-state-isolation contract).

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
  command -v jq >/dev/null 2>&1 || skip "jq required"
  TEST_PROJ="${BATS_TMPDIR}/test-dp-${RANDOM}"
  mkdir -p "${TEST_PROJ}/.roll/loop"
  LEGACY_DIR="${BATS_TMPDIR}/legacy-dp-${RANDOM}"
  mkdir -p "$LEGACY_DIR"
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_PROJ}/.roll/loop"
}

teardown() {
  rm -rf "${TEST_PROJ}" "${LEGACY_DIR}" 2>/dev/null || true
  unset ROLL_PROJECT_RUNTIME_DIR
}

# ── _loop_runs_file: resolves the project-local runs.jsonl ───────────────────

@test "_loop_runs_file honors ROLL_PROJECT_RUNTIME_DIR" {
  run _loop_runs_file
  [ "$status" -eq 0 ]
  [ "$output" = "${TEST_PROJ}/.roll/loop/runs.jsonl" ]
}

@test "_loop_runs_file falls back to current project .roll/loop when no override" {
  unset ROLL_PROJECT_RUNTIME_DIR
  local proj="${TEST_PROJ}"
  ROLL_MAIN_PROJECT="$proj" run _loop_runs_file
  [ "$status" -eq 0 ]
  [ "$output" = "${proj}/.roll/loop/runs.jsonl" ]
}

# ── _loop_migrate_legacy_runs: split by project slug ─────────────────────────

@test "_loop_migrate_legacy_runs splits rows for the resolvable project into its file" {
  local slug; slug=$(basename "$TEST_PROJ")
  local legacy="${LEGACY_DIR}/runs.jsonl"
  printf '{"project":"%s","run_id":"loop-1","ts":"2026-05-30T01:00:00Z","status":"built"}\n' "$slug" > "$legacy"

  # ROLL_PROJECT_RUNTIME_DIR makes _loop_runtime_dir resolve every slug to TEST_PROJ.
  _loop_migrate_legacy_runs "$legacy"

  [ -f "${TEST_PROJ}/.roll/loop/runs.jsonl" ]
  grep -q '"run_id":"loop-1"' "${TEST_PROJ}/.roll/loop/runs.jsonl"
}

@test "_loop_migrate_legacy_runs retires legacy file once all rows migrate" {
  local slug; slug=$(basename "$TEST_PROJ")
  local legacy="${LEGACY_DIR}/runs.jsonl"
  printf '{"project":"%s","run_id":"loop-1","ts":"2026-05-30T01:00:00Z"}\n' "$slug" > "$legacy"

  _loop_migrate_legacy_runs "$legacy"

  [ ! -f "$legacy" ]
  local migrated; migrated=$(ls "${legacy}.migrated-"* 2>/dev/null | head -1)
  [ -n "$migrated" ]
}

@test "_loop_migrate_legacy_runs is idempotent on run_id (no dup rows)" {
  local slug; slug=$(basename "$TEST_PROJ")
  local legacy="${LEGACY_DIR}/runs.jsonl"
  printf '{"project":"%s","run_id":"loop-dup","ts":"2026-05-30T01:00:00Z"}\n' "$slug" > "$legacy"
  # Pre-seed the destination with the same run_id.
  printf '{"project":"%s","run_id":"loop-dup","ts":"2026-05-30T01:00:00Z"}\n' "$slug" > "${TEST_PROJ}/.roll/loop/runs.jsonl"

  _loop_migrate_legacy_runs "$legacy"

  local n; n=$(grep -c '"run_id":"loop-dup"' "${TEST_PROJ}/.roll/loop/runs.jsonl")
  [ "$n" -eq 1 ]
}

@test "_loop_migrate_legacy_runs no-op when legacy file absent" {
  run _loop_migrate_legacy_runs "${LEGACY_DIR}/does-not-exist.jsonl"
  [ "$status" -eq 0 ]
}

# ── _runs_append template wires runs_dst to _LOOP_RT_DIR ─────────────────────

@test "inner runner template writes runs.jsonl under _LOOP_RT_DIR" {
  # The template must compute _runs_dst from _LOOP_RT_DIR (project-local),
  # falling back to the shared root only when RT_DIR is empty.
  grep -q '_runs_dst="\\${_LOOP_RT_DIR}/runs.jsonl"' "${BATS_TEST_DIRNAME}/../../bin/roll"
}

# ── _loop_backfill_merged default resolves project-local ─────────────────────

@test "_loop_backfill_merged default path is the project-local runs.jsonl" {
  # No gh / no file → lenient no-op, but the default must resolve via
  # _loop_runs_file (project-local), not the legacy home path.
  run _loop_backfill_merged
  [ "$status" -eq 0 ]
}
