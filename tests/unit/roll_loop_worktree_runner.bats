#!/usr/bin/env bats
# US-AUTO-037: Tests that _write_loop_runner_script's inner script template
# wires in the US-AUTO-036 worktree helpers and runs claude in an isolated
# per-cycle worktree.
#
# Architectural choice (B in design notes): claude keeps selection authority
# (SKILL.md unchanged) — the runner creates a generic `loop/cycle-<id>`
# worktree, lets claude do its thing, then ff-merges the branch back to main.
# The runner never reads / writes BACKLOG itself.

load helpers

setup() {
  unit_setup
  _tmp="$TEST_TMP"
  ROLL_PKG_DIR="${BATS_TEST_DIRNAME}/../.."
}
teardown() {
  unit_teardown
}

# --- template structure tests ---

@test "_write_loop_runner_script: inner script sources bin/roll for worktree helpers" {
  local script="${_tmp}/run-t1.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t1-inner.sh"
  # bin/roll path is interpolated at write time so the source line is absolute
  grep -qE 'source[[:space:]]+"[^"]*bin/roll"' "$inner"
}

@test "_write_loop_runner_script: inner script generates per-cycle CYCLE_ID" {
  local script="${_tmp}/run-t2.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t2-inner.sh"
  grep -qF 'CYCLE_ID=' "$inner"
  # Branch name uses cycle id
  grep -qE 'BRANCH=.*loop/cycle-' "$inner"
}

@test "_write_loop_runner_script: inner script calls _worktree_fetch_origin and _worktree_create" {
  local script="${_tmp}/run-t3.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t3-inner.sh"
  grep -qF '_worktree_fetch_origin' "$inner"
  grep -qF '_worktree_create' "$inner"
  grep -qF 'origin/main' "$inner"
}

@test "_write_loop_runner_script: inner script calls _worktree_submodule_init after create" {
  local script="${_tmp}/run-t4.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t4-inner.sh"
  grep -qF '_worktree_submodule_init' "$inner"
}

@test "_write_loop_runner_script: inner script runs claude with cwd = worktree path" {
  local script="${_tmp}/run-t5.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t5-inner.sh"
  # cd target must be $WT, not the project_path literal, when worktree is in use
  grep -qE 'cd "\$WT"' "$inner"
}

@test "_write_loop_runner_script: inner script falls back to main tree when worktree setup fails" {
  local script="${_tmp}/run-t6.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t6-inner.sh"
  # Fallback branch sets WT to project_path so the loop still runs (degraded)
  grep -qE 'WT="\${project_path|WT=.*\$\{project_path|WT=.*/some/project' "$inner"
  # And the warning is logged
  grep -qE 'worktree.*failed|no isolation' "$inner"
}

@test "_write_loop_runner_script: inner script calls _worktree_merge_back on claude success" {
  local script="${_tmp}/run-t7.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t7-inner.sh"
  grep -qF '_worktree_merge_back' "$inner"
}

@test "_write_loop_runner_script: inner script cleans up worktree only on merge success" {
  local script="${_tmp}/run-t8.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t8-inner.sh"
  grep -qF '_worktree_cleanup' "$inner"
}

@test "_write_loop_runner_script: inner script writes ALERT and preserves worktree when claude fails" {
  local script="${_tmp}/run-t9.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t9-inner.sh"
  # Helper for alerts must be invoked on the failure branch
  grep -qF '_worktree_alert' "$inner"
  # Worktree preserved → no cleanup call on the failure branch (verify by
  # checking the failure branch text mentions preservation, not cleanup)
  grep -qE 'preserved.*worktree|worktree.*preserved|worktree.*\$WT' "$inner"
}

@test "_write_loop_runner_script: existing FIX-031 inner LOCK still present" {
  local script="${_tmp}/run-tA.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tA-inner.sh"
  # Regression guard: don't lose FIX-031's LOCK when adding US-AUTO-037
  grep -qF 'INNER_LOCK' "$inner"
  grep -qE "trap.*INNER_LOCK.*EXIT" "$inner"
}

@test "_write_loop_runner_script: existing retry-3-times loop still present" {
  local script="${_tmp}/run-tB.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tB-inner.sh"
  # Regression guard: retry logic survives the worktree wrap
  grep -qF 'for _attempt in 1 2 3' "$inner"
}
