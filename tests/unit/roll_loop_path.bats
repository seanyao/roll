#!/usr/bin/env bats
# Tests for runner script PATH export (FIX-017)
# launchd default PATH doesn't include /opt/homebrew/bin. claude inherits
# bash's PATH but when it spawns hooks via `sh -c "node ..."`, the brew
# tools become unreachable. Runner template must export PATH explicitly so
# every child process in the chain can find node/claude/etc.

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  source "$ROLL_BIN"
  _orig_dir="$PWD"
  _test_dir=$(mktemp -d)
  cd "$_test_dir"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_test_dir"
}

@test "_write_loop_runner_script: inner script exports /opt/homebrew/bin in PATH" {
  local script_path="${_test_dir}/run-test-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  [ -f "$inner_script" ]
  grep -qF 'export PATH=' "$inner_script"
  grep -qF '/opt/homebrew/bin' "$inner_script"
}

@test "_write_loop_runner_script: PATH export runs before claude command (inner)" {
  local script_path="${_test_dir}/run-test-path-order.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  local export_line cmd_line
  export_line=$(grep -n 'export PATH=' "$inner_script" | head -1 | cut -d: -f1)
  cmd_line=$(grep -n 'cd "/tmp/proj"' "$inner_script" | head -1 | cut -d: -f1)
  [[ -n "$export_line" && -n "$cmd_line" ]]
  [[ "$export_line" -lt "$cmd_line" ]]
}

@test "_write_loop_runner_script: cmd is augmented with claude --verbose for attach visibility" {
  local script_path="${_test_dir}/run-test-verbose.sh"
  # The agent_cmd typically starts with claude -p; inner runner should rewrite
  # to claude --verbose -p so the tmux attach view shows live progress.
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p \"prompt\"" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  grep -qE 'claude --verbose -p|claude -p .* --verbose|--verbose' "$inner_script"
}

@test "_write_loop_runner_script: non-claude cmds (kimi/deepseek) are NOT modified" {
  # --verbose injection must be claude-specific; other agents shouldn't get it
  local script_path="${_test_dir}/run-test-kimi.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "kimi --quiet -p \"prompt\"" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  ! grep -qF 'kimi --verbose' "$inner_script"
  grep -qF 'kimi --quiet -p' "$inner_script"
}
