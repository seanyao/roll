#!/usr/bin/env bats
# Tests for runner script PATH export (FIX-017)
# launchd default PATH doesn't include /opt/homebrew/bin. claude inherits
# bash's PATH but when it spawns hooks via `sh -c "node ..."`, the brew
# tools become unreachable. Runner template must export PATH explicitly so
# every child process in the chain can find node/claude/etc.

load helpers
setup() {
  unit_setup_cd
  _test_dir="$TEST_TMP"
}
teardown() { unit_teardown_cd; }

@test "_write_loop_runner_script: inner script exports /opt/homebrew/bin in PATH" {
  local script_path="${_test_dir}/run-test-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  [ -f "$inner_script" ]
  grep -qF 'export PATH' "$inner_script"
  grep -qF '/opt/homebrew/bin' "$inner_script"
}

@test "_write_loop_runner_script: PATH export runs before claude command (inner)" {
  local script_path="${_test_dir}/run-test-path-order.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "claude -p" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  local export_line cmd_line
  export_line=$(grep -n 'export PATH' "$inner_script" | head -1 | cut -d: -f1)
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

# FIX-050: launchd/cron deliver a bare PATH. Hardcoded /opt/homebrew/bin breaks
# on Intel macOS, Linux cron, and any future tool-prefix change. Two layers:
# (1) setup-time PATH in plist EnvironmentVariables; (2) cross-platform PATH
# assembly at the top of both outer + inner runner scripts.

@test "_write_loop_runner_script: inner script uses portable PATH assembly (no bare /opt/homebrew hardcode)" {
  local script_path="${_test_dir}/run-test-portable-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  local inner_script="${script_path%.sh}-inner.sh"
  # Should NOT contain the legacy single-line hardcode
  ! grep -qF 'export PATH="/opt/homebrew/bin:$PATH"' "$inner_script"
  # Should contain a loop iterating candidate dirs (portable assembly)
  grep -q 'for _d in' "$inner_script"
  # Candidate set includes both Apple Silicon and Intel/Linux prefixes
  grep -qF '/opt/homebrew/bin' "$inner_script"
  grep -qF '/usr/local/bin' "$inner_script"
}

@test "_write_loop_runner_script: outer script also assembles PATH (covers launchd before tmux check)" {
  local script_path="${_test_dir}/run-test-outer-path.sh"
  _write_loop_runner_script "$script_path" "/tmp/proj" "echo hi" "/tmp/log" 10 24
  # Outer script needs PATH set before tmux command-v check at the top
  grep -q 'for _d in' "$script_path"
  grep -qF '/opt/homebrew/bin' "$script_path"
}

@test "_detect_path_prepend: emits colon-separated list with standard dirs" {
  local out; out=$(_detect_path_prepend)
  [[ "$out" == *"/usr/bin"* ]]
  [[ "$out" == *":"* ]]
}

@test "_write_launchd_plist: writes EnvironmentVariables PATH key" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local plist="${tmp_dir}/test.plist"
  _write_launchd_plist "$plist" "com.roll.loop.test" "/tmp/proj" "0" "" "${tmp_dir}/run.sh"
  grep -q '<key>EnvironmentVariables</key>' "$plist"
  grep -q '<key>PATH</key>' "$plist"
  rm -rf "$tmp_dir"
}
