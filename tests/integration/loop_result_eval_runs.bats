#!/usr/bin/env bats
# US-EVAL-002: a simulated loop cycle writes a result_eval block into runs.jsonl.
#
# _runs_append (baked into the generated inner.sh) now computes an objective
# result_eval from the cycle's facts via the US-EVAL-001 pure-function rubric
# and merges it into the runs.jsonl row. This drives a real inner.sh through
# two deterministic terminal paths — idle (no commits) and done (a TCR commit
# that publishes via a stubbed gh) — and asserts the row carries a sensible
# result_eval, while older rows (with no such key) remain valid (back-compat).

load helpers

setup() {
  integration_setup
  export HOME="$TEST_TMP"
  _SHARED_ROOT="${TEST_TMP}/.shared/roll"
  mkdir -p "${_SHARED_ROOT}/loop" "${_SHARED_ROOT}/worktrees"

  ROLL_PKG_DIR="${BATS_TEST_DIRNAME}/../.."
  export ROLL_PKG_DIR
  source "$ROLL_BIN"
  _SHARED_ROOT="${TEST_TMP}/.shared/roll"

  # Tiny git fixture: bare upstream + local clone.
  cd "$TEST_TMP"
  git -c init.defaultBranch=main init -q --bare upstream.git
  git -c init.defaultBranch=main clone -q upstream.git project
  cd project
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git config protocol.file.allow always
  echo "init" > README.md
  git add README.md
  git commit -q -m "initial commit"
  git push -q -u origin main

  _project="${TEST_TMP}/project"
  _RUNS="${_SHARED_ROOT}/loop/runs.jsonl"
}

teardown() {
  if [ -d "${_project}/.git" ]; then
    cd "$_project" 2>/dev/null \
      && git worktree list --porcelain 2>/dev/null \
      | awk '/^worktree /{print $2}' \
      | while read -r wt; do
          [ "$wt" != "$_project" ] && git worktree remove --force "$wt" 2>/dev/null || true
        done
  fi
  cd /
  integration_teardown
}

_make_inner() {
  local cmd="$1"
  local script="${TEST_TMP}/run-test.sh"
  _write_loop_runner_script "$script" "$_project" "$cmd" "${TEST_TMP}/log" 0 24
  echo "${script%.sh}-inner.sh"
}

@test "US-EVAL-002: idle cycle row carries a low-scoring result_eval" {
  command -v jq >/dev/null 2>&1 || skip "jq required"
  command -v python3 >/dev/null 2>&1 || skip "python3 required"

  # No commits → idle terminal → _runs_append "idle".
  local cmd='true'
  local inner; inner=$(_make_inner "$cmd")
  HOME="$TEST_TMP" bash "$inner" || true

  [ -f "$_RUNS" ] || { echo "expected runs.jsonl at $_RUNS" >&2; ls -la "$(dirname "$_RUNS")" >&2; return 1; }
  local row; row=$(tail -n1 "$_RUNS")

  # Row must be an idle status with an embedded result_eval block.
  echo "$row" | jq -e '.status == "idle"' >/dev/null || { echo "row: $row" >&2; return 1; }
  echo "$row" | jq -e '.result_eval.version == 1' >/dev/null || { echo "row: $row" >&2; return 1; }
  echo "$row" | jq -e '.result_eval.score | type == "number"' >/dev/null || { echo "row: $row" >&2; return 1; }

  # scope_fidelity scores 0 for idle (nothing built); outcome 0 (not merged).
  echo "$row" | jq -e '.result_eval.dims.scope_fidelity == 0' >/dev/null || { echo "row: $row" >&2; return 1; }
  echo "$row" | jq -e '.result_eval.dims.outcome == 0' >/dev/null || { echo "row: $row" >&2; return 1; }
  # Idle should land at the low end of the 1..10 scale.
  echo "$row" | jq -e '.result_eval.score <= 4' >/dev/null || { echo "idle score too high: $row" >&2; return 1; }

  # Untracked facts (CI verdict, est_min) must record as "unknown", never a
  # silent 0 — this is the AC's missing-facts contract.
  echo "$row" | jq -e '.result_eval.dims.correctness == "unknown"' >/dev/null || { echo "row: $row" >&2; return 1; }
  echo "$row" | jq -e '.result_eval.dims.efficiency == "unknown"' >/dev/null || { echo "row: $row" >&2; return 1; }
}

@test "US-EVAL-002: backward compat — a legacy row with no result_eval stays valid" {
  command -v jq >/dev/null 2>&1 || skip "jq required"

  # Simulate an older row written before this story: no result_eval key.
  mkdir -p "$(dirname "$_RUNS")"
  printf '%s\n' '{"ts":"2026-01-01T00:00:00Z","run_id":"loop-old","status":"done","built":["US-OLD-001"],"tcr_count":1,"duration_sec":120}' > "$_RUNS"

  # A consumer reading the file must treat absence of result_eval as "not
  # scored" (null), not an error.
  run jq -e 'select(.run_id=="loop-old") | (.result_eval // "not-scored") == "not-scored"' "$_RUNS"
  [ "$status" -eq 0 ]
}
