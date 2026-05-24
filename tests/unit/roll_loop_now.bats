#!/usr/bin/env bats
# Tests for _loop_now behavior parity with launchd-triggered service (FIX-021)
# loop now must walk the SAME path as the scheduled service: runner script →
# tmux session → claude --verbose -p → Terminal.app popup. ROLL_LOOP_FORCE bypasses
# only the active-window guard so the manual invocation isn't time-gated.

load helpers
setup() {
  unit_setup_cd
  _test_dir="$TEST_TMP"
}
teardown() { unit_teardown_cd; }

@test "_loop_now: invokes the project runner script (not _agent_run_skill)" {
  local body
  body=$(awk '/^_loop_now\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # No more direct _agent_run_skill call in the loop now path
  ! echo "$body" | grep -qF "_agent_run_skill \"roll-loop\""
  # Should reference the runner script path
  echo "$body" | grep -qE 'run-.*\.sh|_SHARED_ROOT.*loop/run|runner'
}

@test "_loop_now: sets ROLL_LOOP_FORCE to bypass active-window check" {
  local body
  body=$(awk '/^_loop_now\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'ROLL_LOOP_FORCE'
}

@test "_loop_now: emits Chinese-correct startup message" {
  local body
  body=$(awk '/^_loop_now\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF '正在启动新的循环'
}

@test "_write_loop_runner_script: active-window check honors ROLL_LOOP_FORCE" {
  local script_path="${_test_dir}/run-test-force.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 18
  # The window check should be skippable when ROLL_LOOP_FORCE is non-empty
  grep -qF 'ROLL_LOOP_FORCE' "$script_path"
}

# ─── roll loop test (FIX-023) ─────────────────────────────────────────────────

@test "cmd_loop: 'test' subcommand is recognized in dispatch table" {
  local body
  body=$(awk '/^cmd_loop\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '\btest\)'
}

@test "_loop_test: function exists in bin/roll" {
  grep -qF '_loop_test()' "$ROLL_BIN"
}

@test "_loop_test: uses _write_loop_runner_script with a trivial claude prompt" {
  local body
  body=$(awk '/^_loop_test\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Must reuse the same runner infrastructure (not bypass it)
  echo "$body" | grep -qF '_write_loop_runner_script'
  # Must use a trivial prompt — not the full skill
  echo "$body" | grep -qiE 'hello|trivial|Reply'
}

@test "_loop_test: sets ROLL_LOOP_FORCE to bypass active-window check" {
  local body
  body=$(awk '/^_loop_test\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'ROLL_LOOP_FORCE'
}

# ─── US-LOOP-010: roll loop test --agent <name> ────────────────────────────────

@test "_loop_test: accepts --agent flag" {
  local body
  body=$(awk '/^_loop_test\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE -- '--agent\)'
}

@test "_loop_test: accepts --cmd flag for custom agent invocation" {
  local body
  body=$(awk '/^_loop_test\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE -- '--cmd\)'
}

@test "_loop_test: defaults to claude when --agent not given" {
  local body
  body=$(awk '/^_loop_test\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Default literal `agent="claude"` must appear
  echo "$body" | grep -qF 'agent="claude"'
}

@test "_loop_test: non-claude agent gets mock echo cmd (no real binary needed)" {
  local body
  body=$(awk '/^_loop_test\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Mock fallback line for non-claude agents
  echo "$body" | grep -qiE "mock .* output"
}

@test "cmd_loop: 'test' subcommand forwards args via shift" {
  local body
  body=$(awk '/^cmd_loop\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Must shift before passing remaining args to _loop_test so flags like
  # --agent pi reach the function
  echo "$body" | grep -qE 'test\).*shift.*_loop_test'
}
