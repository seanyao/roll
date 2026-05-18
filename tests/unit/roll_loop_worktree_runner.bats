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

@test "_write_loop_runner_script: inner script skips cycle (exit 0) when worktree setup fails" {
  local script="${_tmp}/run-t6.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t6-inner.sh"
  # P3 fix: no fallback to main tree — cycle is skipped to avoid running without isolation
  ! grep -qE 'WT="\$\{project_path|WT=.*/some/project' "$inner"
  # Skips via exit 0 and writes ALERT
  grep -qE 'exit 0' "$inner"
  grep -qE 'worktree.*failed|no isolation|skipping cycle' "$inner"
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
  # FIX-057: trap was refactored into _inner_cleanup function — assert the
  # EXIT trap exists and the cleanup logic still removes INNER_LOCK.
  grep -qE "trap .* EXIT" "$inner"
  grep -qE 'rm -f.*INNER_LOCK' "$inner"
}

@test "_write_loop_runner_script: existing retry-3-times loop still present" {
  local script="${_tmp}/run-tB.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tB-inner.sh"
  # Regression guard: retry logic survives the worktree wrap
  grep -qF 'for _attempt in 1 2 3' "$inner"
}

@test "_write_loop_runner_script: idle cycle skips publish and cleans worktree directly" {
  local script="${_tmp}/run-tC.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tC-inner.sh"
  # idle check counts commits ahead of origin/main
  grep -qE 'git rev-list --count origin/main\.\.HEAD' "$inner"
  # idle path calls cleanup without publish
  grep -qE 'idle.*no new commits|no new commits.*idle' "$inner"
}

@test "_write_loop_runner_script: FIX-037 outer script contains orphan state detection" {
  local script="${_tmp}/run-tD.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  # FIX-037 detection lives in the OUTER script (runner), not the inner
  grep -qF 'FIX-037: orphan state detection' "$script"
  # Checks state.yaml status field
  grep -qF "grep '^status:'" "$script"
  # Atomic write pattern: echo to .tmp then mv
  grep -qF '.tmp' "$script"
  grep -qF '&& mv' "$script"
  # ALERT written on heal
  grep -qF 'ALERT.md' "$script"
}

@test "_write_loop_runner_script: FIX-038 inner script writes heartbeat every 60s" {
  local script="${_tmp}/run-tE.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tE-inner.sh"
  # Heartbeat background writer present
  grep -qF 'HEARTBEAT_FILE' "$inner"
  grep -qF 'sleep 60' "$inner"
  grep -qF '_heartbeat_writer' "$inner"
  # Cleans up heartbeat PID on EXIT
  grep -qF '_HEARTBEAT_PID' "$inner"
  grep -qF 'HEARTBEAT_FILE' "$inner"
  grep -qF 'trap' "$inner"
}

@test "_write_loop_runner_script: FIX-038 outer script checks heartbeat as primary liveness" {
  local script="${_tmp}/run-tF.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  # Heartbeat timeout configurable via env var
  grep -qF 'ROLL_HEARTBEAT_TIMEOUT' "$script"
  # Heartbeat is primary, LOCK pid fallback exists
  grep -qF 'heartbeat is primary' "$script"
  # LOCK pid fallback still present
  grep -qF '_lock_file' "$script"
  # heartbeat file pattern
  grep -qF '.heartbeat-' "$script"
}

@test "_write_loop_runner_script: FIX-045 orphan recovery rebases onto origin/main before publish" {
  local script="${_tmp}/run-fix045.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-fix045-inner.sh"
  # Rebase onto origin/main must appear in orphan recovery section
  grep -qF 'git rebase origin/main' "$inner"
  # Fetch must precede rebase
  grep -qF 'git fetch origin main' "$inner"
  # On rebase failure, recovery is skipped (continue) with a log message
  grep -qF 'FIX-045' "$inner"
}

@test "_write_loop_runner_script: FIX-047 inner script waits for PR merge after non-doc publish" {
  local script="${_tmp}/run-fix047.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-fix047-inner.sh"
  # Must call _loop_wait_pr_merge for non-doc code changes
  grep -qF '_loop_wait_pr_merge' "$inner"
  # Must have FIX-047 annotation
  grep -qF 'FIX-047' "$inner"
  # Must track doc-only flag to skip wait for doc-only PRs (admin merge = immediate)
  grep -qF '_is_doc_only' "$inner"
}

@test "_write_loop_runner_script: outer script starts caffeinate to prevent sleep" {
  local script="${_tmp}/run-tG.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  grep -qF 'caffeinate' "$script"
}

@test "_write_loop_runner_script: inner script has single EXIT trap that cleans lock + heartbeat" {
  local script="${_tmp}/run-tH.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tH-inner.sh"
  # Inner relies on outer caffeinate — no inner caffeinate assertion should leak in.
  ! grep -qF 'caffeinate' "$inner"
  # Single EXIT trap, covering both INNER_LOCK and HEARTBEAT_FILE cleanup.
  # FIX-057: trap was refactored into _inner_cleanup function; assert one
  # EXIT trap exists and the cleanup logic touches both files.
  [ "$(grep -c "trap .* EXIT" "$inner")" -eq 1 ]
  grep -qE 'rm -f.*INNER_LOCK.*HEARTBEAT_FILE' "$inner"
}
