#!/usr/bin/env bats
# FIX-057: cycle hard timeout — 45 minute SLA per loop cycle.
#
# After 45 minutes, the inner script kills claude / loop-fmt.py / all background
# children, marks the in-progress backlog item as 🚧 Blocked, writes a
# cycle_end event with outcome=blocked, and exits cleanly so the next cron
# tick can proceed.

load helpers

setup() {
  unit_setup_cd
  _test_dir="$TEST_TMP"
  git -c init.defaultBranch=main init -q --bare "${_test_dir}/.upstream.git"
  git -c init.defaultBranch=main init -q
  git remote add origin "${_test_dir}/.upstream.git"
  git config user.email "test@roll.dev"
  git config user.name "Test"
  git config commit.gpgsign false
  git config protocol.file.allow always
  git commit --allow-empty -q -m "initial"
  git push -q origin main
}
teardown() {
  unit_teardown_cd
}

# --- Template structure tests ---

@test "inner: declares ROLL_LOOP_CYCLE_TIMEOUT_SEC with 2700 default" {
  local script_path="${_test_dir}/run-test-timeout.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  local inner="${script_path%.sh}-inner.sh"
  grep -qE 'ROLL_LOOP_CYCLE_TIMEOUT_SEC.*:-2700' "$inner"
}

@test "inner: spawns a watchdog backgrounded with sleep + kill" {
  local script_path="${_test_dir}/run-test-watchdog.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  local inner="${script_path%.sh}-inner.sh"
  # Watchdog must be a backgrounded sleep + kill so it can fire while
  # the foreground pipe (claude | python3 loop-fmt) is waiting. Allow
  # the sleep and the kill to be on adjacent lines (FIX-068 expanded the
  # watchdog body into a multi-line block).
  grep -qE 'sleep "\$LOOP_CYCLE_TIMEOUT_SEC"' "$inner"
  grep -qE 'kill -TERM \$\$' "$inner"
}

@test "inner: FIX-068 watchdog targets claude by worktree path" {
  local script_path="${_test_dir}/run-test-wt-match.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  local inner="${script_path%.sh}-inner.sh"
  # Watchdog must signal claude itself, not just direct children of the
  # inner shell. Match by worktree path ($WT) — unique per cycle so
  # concurrent cycles in other projects are never touched.
  grep -qE 'pkill -TERM -f "\$WT"' "$inner"
}

@test "inner: FIX-068 watchdog escalates to SIGKILL after grace period" {
  local script_path="${_test_dir}/run-test-sigkill.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  local inner="${script_path%.sh}-inner.sh"
  # If claude ignores SIGTERM (mid-tool-call, blocked syscall), the watchdog
  # must escalate to SIGKILL so the cycle can't run past its budget.
  grep -qE 'pkill -KILL -f "\$WT"' "$inner"
  # Grace period before escalation
  grep -qE 'sleep 5' "$inner"
}

@test "inner: FIX-068 _CYCLE_TIMED_OUT is reset at the start of each retry attempt" {
  local script_path="${_test_dir}/run-test-reset.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  local inner="${script_path%.sh}-inner.sh"
  # Without a reset, a SIGTERM in attempt 1 would force an immediate break
  # on attempts 2 and 3 even when those attempts ran cleanly.
  grep -qE '_CYCLE_TIMED_OUT=0' "$inner"
}

@test "inner: EXIT trap kills all background jobs, not just heartbeat" {
  local script_path="${_test_dir}/run-test-trap.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  local inner="${script_path%.sh}-inner.sh"
  # Trap must iterate `jobs -p` (or equivalent) to kill stuck loop-fmt.py
  # / publish subshells, not only the heartbeat writer.
  grep -qE 'jobs -p' "$inner"
}

@test "inner: writes cycle_end with outcome=blocked on timeout" {
  local script_path="${_test_dir}/run-test-blocked-event.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  local inner="${script_path%.sh}-inner.sh"
  grep -qE 'cycle_end.*"blocked"' "$inner"
}

# --- Outer runner timeout (FIX-057 root: outer wait loop had no deadline) ---

@test "outer: tmux wait loop has a deadline guarded by _OUTER_TIMEOUT" {
  local script_path="${_test_dir}/run-test-outer-tmout.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  grep -qF '_OUTER_TIMEOUT' "$script_path"
}

@test "outer: tmux wait loop kills session on deadline breach" {
  local script_path="${_test_dir}/run-test-outer-kill.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  # Must kill the session (not just break) so the tmux session is torn down
  # even when remain-on-exit is set in the user's tmux config.
  grep -qE 'tmux kill-session.*SESSION' "$script_path"
}

@test "outer: deadline uses ROLL_LOOP_CYCLE_TIMEOUT_SEC env var" {
  local script_path="${_test_dir}/run-test-outer-envvar.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p foo" "/tmp/log" 10 18
  grep -qE 'ROLL_LOOP_CYCLE_TIMEOUT_SEC.*2700' "$script_path"
}

# --- Behaviour test: timeout actually fires ---

@test "inner: timeout kills hanging pipe and exits within budget" {
  local script_path="${_test_dir}/run-test-behave.sh"
  # Stub claude with a script that sleeps far longer than the test timeout.
  # The bin name must match so the cmd substitution in the template still works.
  mkdir -p "${_test_dir}/stubbin"
  cat > "${_test_dir}/stubbin/claude" <<'STUB'
#!/bin/bash
# Pretend to be claude -p; just hang.
sleep 600
STUB
  chmod +x "${_test_dir}/stubbin/claude"

  _write_loop_runner_script "$script_path" "${_test_dir}" "claude -p hi" "/tmp/log" 0 24
  local inner="${script_path%.sh}-inner.sh"

  # 3s timeout for the test. Run inner in background; expect it to exit
  # on its own within ~15s. timeout(1) is not portable on macOS, so we poll.
  ROLL_LOOP_CYCLE_TIMEOUT_SEC=3 \
  PATH="${_test_dir}/stubbin:$PATH" \
    bash "$inner" >/dev/null 2>&1 &
  local inner_pid=$!
  local waited=0
  while kill -0 "$inner_pid" 2>/dev/null && [ "$waited" -lt 15 ]; do
    sleep 1; waited=$((waited+1))
  done
  if kill -0 "$inner_pid" 2>/dev/null; then
    kill -KILL "$inner_pid" 2>/dev/null
    return 1   # inner did not exit within 15s — timeout did not fire
  fi
  # Lock file must be released.
  local inner_lock="$(dirname "$inner")/.INNER-LOCK-$(basename "$inner" -inner.sh | sed 's/^run-//')"
  [ ! -f "$inner_lock" ]
}
