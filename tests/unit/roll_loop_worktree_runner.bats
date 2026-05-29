#!/usr/bin/env bats
# bats tier: fast
# US-AUTO-037: Tests that _write_loop_runner_script's inner script template
# wires in the US-AUTO-036 worktree helpers and runs claude in an isolated
# per-cycle worktree.
# (No actual sleep calls — auto-classifier sees 'sleep N' in grep patterns, overriding to fast)
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

@test "_write_loop_runner_script: FIX-069 inner script syncs .roll/ meta into worktree before claude" {
  local script="${_tmp}/run-t4b.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-t4b-inner.sh"
  grep -qF '_worktree_sync_meta' "$inner"
  # Must fire after submodule init, before the cycle_start event is emitted.
  # Match the event-emit line specifically (not the word "cycle_start" in comments).
  local sync_line;  sync_line=$(grep -n  '_worktree_sync_meta'         "$inner" | head -1 | cut -d: -f1)
  local sub_line;   sub_line=$(grep -n   '_worktree_submodule_init'    "$inner" | head -1 | cut -d: -f1)
  local start_line; start_line=$(grep -n '_loop_event cycle_start'     "$inner" | head -1 | cut -d: -f1)
  [ "$sub_line" -lt "$sync_line" ]
  [ "$sync_line" -lt "$start_line" ]
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

@test "_write_loop_runner_script: FIX-060 runs.jsonl record includes cycle_id field" {
  local script="${_tmp}/run-tFIX060.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tFIX060-inner.sh"
  # The runs.jsonl writer must thread CYCLE_ID through so _loop_backfill_merged
  # can resolve the matching loop/cycle-<id> PR. Without this field the merge
  # backfill scanner has no way to identify the branch.
  grep -qE 'cycle_id[":[:space:]]*\$CYCLE_ID|--arg cycle_id' "$inner"
  grep -qF 'cycle_id:' "$inner"
}

@test "_write_loop_runner_script: attach.command shows log with less after session ends (FIX-131)" {
  # FIX-131: after the tmux session ends, the .command window now opens the
  # cron log with `less -R +G` so the user can scroll through the full cycle
  # output instead of seeing an empty screen and "press enter to close".
  # `read _` is still there as a fallback when the log file is not found.
  local script="${_tmp}/run-tATTACH.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  # Old form must be gone from the outer runner.
  ! grep -qF 'exec tmux attach' "$script"
  # New form: bare attach (no exec) + less fallback.
  grep -qF 'tmux attach -t' "$script"
  grep -qF 'less -R +G' "$script"
  # read _ still present as fallback when log is missing
  grep -qF 'read _' "$script"
}

@test "_write_loop_runner_script: FIX-F idle cycle writes terminal cycle_end and runs row" {
  # Observed live during the 2026-05-25 13:18 and 14:18 pi cycles: agent
  # exited cleanly (idle), but the runs.jsonl row was status:"aborted" and
  # the events file ended with cycle_end:"aborted". The idle path only
  # emitted an "idle" status event, not the terminal cycle_end, so the
  # EXIT trap fallback (which classifies anything with _CYCLE_END_WRITTEN=0
  # as aborted) ran. Regression: the idle branch must mark itself terminal.
  local script="${_tmp}/run-tFIXF.sh"
  _write_loop_runner_script "$script" "/some/project" "claude -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-tFIXF-inner.sh"
  grep -qF '_loop_event cycle_end "${CYCLE_ID}" "" "idle"' "$inner"
  grep -qF '_runs_append "idle"' "$inner"
  # The idle branch must set _CYCLE_END_WRITTEN so the cleanup trap's
  # fallback does NOT overwrite this row with "aborted".
  awk '/Idle cycle — no commits ahead/{flag=1} flag && /_CYCLE_END_WRITTEN=1/{found=1; exit} END{exit !found}' "$inner"
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
  # FIX-136: phase file for cross-process phase tracking
  grep -qF 'HEARTBEAT_PHASE_FILE' "$inner"
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
  # FIX-057: trap was refactored into _inner_cleanup function; assert at least one
  # EXIT trap exists and the cleanup logic touches both files.
  grep -q "trap .* EXIT" "$inner"
  grep -qE 'rm -f.*INNER_LOCK.*HEARTBEAT_FILE' "$inner"
}

@test "US-LOOP-026: inner script calls pi_emit once post-cycle for non-claude agents" {
  local script="${_tmp}/run-pi.sh"
  _write_loop_runner_script "$script" "/some/project" "pi -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-pi-inner.sh"
  # The post-cycle usage capture is gated on a non-claude agent and invokes
  # pi_emit.py exactly once with the cycle's worktree + id.
  grep -qF 'agent_usage/pi_emit.py' "$inner"
  grep -qE '_project_agent.*!=.*claude' "$inner"
  [ "$(grep -c 'pi_emit.py' "$inner")" -eq 2 ]  # local var def + invocation
  # Must run after the agent phase ends, before worktree cleanup removes $WT.
  local emit_line;  emit_line=$(grep -n 'pi_emit.py" --cwd' "$inner" | head -1 | cut -d: -f1)
  local phase_line; phase_line=$(grep -n '_phase_end agent_invoke ok' "$inner" | head -1 | cut -d: -f1)
  [ "$phase_line" -lt "$emit_line" ]
}

@test "_write_loop_runner_script: FIX-136 non-claude agents get PTY wrapper for streaming" {
  local script="${_tmp}/run-fix136a.sh"
  # Use a non-claude command (pi -p) to simulate a pi/deepseek cycle
  _write_loop_runner_script "$script" "/some/project" "pi -p hi" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-fix136a-inner.sh"
  # PTY wrapper variable defined for non-claude agents
  grep -qF '_AGENT_PTY_PREFIX' "$inner"
  grep -qF 'script -q /dev/null' "$inner"
  # Agent invoke lines must use the wrapper (not bare eval)
  grep -qF 'eval $_AGENT_PTY_PREFIX' "$inner"
  grep -qF '$_AGENT_PTY_PREFIX pi' "$inner"
}
