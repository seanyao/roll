#!/usr/bin/env bats
# bats tier: fast
# Tests for roll loop attach + tmux-wrapped runner (US-AUTO-025)
# (No actual sleep calls — auto-classifier sees 'sleep 30' in grep patterns, overriding to fast)

load helpers
setup() {
  unit_setup_cd
  _tmp="$TEST_TMP"
}
teardown() { unit_teardown_cd; }

# ─── Dispatch ─────────────────────────────────────────────────────────────────

@test "cmd_loop routes 'attach' to _loop_attach" {
  grep -qE 'attach\)[[:space:]]+_loop_attach' "$ROLL_BIN"
}

@test "cmd_loop usage line lists 'attach'" {
  grep -qE 'Usage: roll loop .*attach' "$ROLL_BIN"
}

# ─── Runner script template includes tmux logic ──────────────────────────────

@test "_write_loop_runner_script: emits tmux availability check" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'command -v tmux' "$script"
}

@test "_write_loop_runner_script: falls back when tmux missing" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  # Fallback branch — `else` followed by non-tmux execution
  grep -qE '^else$' "$script"
}

@test "_write_loop_runner_script: uses slug-derived tmux session name" {
  local script="${_tmp}/run-myslug.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'SESSION=' "$script"
  grep -qF 'roll-loop-' "$script"
}

@test "_write_loop_runner_script: kills existing session before starting" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'tmux kill-session' "$script"
}

@test "_write_loop_runner_script: starts detached session via new-session -d" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qE 'tmux new-session -d' "$script"
}

@test "_write_loop_runner_script: pipes pane to log file" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'pipe-pane' "$script"
}

@test "_write_loop_runner_script: waits for session to end before releasing LOCK" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'has-session' "$script"
}

@test "_write_loop_runner_script: trap cleanup kills session on exit" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  # Cleanup section both removes LOCK and (best-effort) kills session
  local body; body=$(cat "$script")
  grep -qF 'rm -f' <<< "$body"
  grep -qF 'kill-session' <<< "$body"
}

@test "_write_loop_runner_script: writes inner script with the cmd payload" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo INNER_PAYLOAD" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-test-inner.sh"
  [ -f "$inner" ]
  grep -qF 'INNER_PAYLOAD' "$inner"
  [ -x "$inner" ]
}

@test "_write_loop_runner_script: inner script retries up to 3 times on failure" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo INNER_PAYLOAD" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-test-inner.sh"
  grep -qF 'for _attempt in 1 2 3' "$inner"
  grep -qF 'sleep 30' "$inner"
}

@test "_write_loop_runner_script: inner script uses pipefail for pipe exit propagation" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo INNER_PAYLOAD" "${_tmp}/log" 10 24
  local inner="${_tmp}/run-test-inner.sh"
  grep -qF 'set -o pipefail' "$inner"
}

@test "_write_loop_runner_script: runner references the inner script path" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  grep -qF 'run-test-inner.sh' "$script"
}

@test "_write_loop_runner_script: fallback path executes inner without tmux" {
  local script="${_tmp}/run-test.sh"
  _write_loop_runner_script "$script" "/some/project" "echo hi" "${_tmp}/log" 10 24
  # The fallback branch must run the inner script, redirecting to log
  grep -qE 'bash "\$INNER_SCRIPT" >> "\$LOG"' "$script"
}

# ─── _loop_attach behavior ───────────────────────────────────────────────────

@test "_loop_attach: source references command -v tmux for soft dependency" {
  local body
  body=$(awk '/^_loop_attach\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'command -v tmux'
}

@test "_loop_attach: source uses tmux has-session to detect running loop" {
  local body
  body=$(awk '/^_loop_attach\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'has-session'
}

@test "_loop_attach: source calls exec tmux attach when session exists" {
  local body
  body=$(awk '/^_loop_attach\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE 'exec[[:space:]]+tmux[[:space:]]+attach'
}

@test "_loop_attach: source computes session name from project slug" {
  local body
  body=$(awk '/^_loop_attach\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF '_project_slug'
  echo "$body" | grep -qF 'roll-loop-'
}

@test "_loop_attach: exits non-zero when no session exists (live)" {
  # Use a sentinel project path so the derived slug is unique
  _project_slug() { echo "nonexistent-$(date +%s%N)"; }
  run _loop_attach
  [ "$status" -ne 0 ]
  [[ "$output" == *"No running loop"* ]] || [[ "$output" == *"tmux"* ]]
}
