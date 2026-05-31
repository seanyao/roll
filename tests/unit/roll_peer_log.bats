#!/usr/bin/env bats
# Unit tests for FIX-150a: roll peer log / roll peer runs query commands.

load helpers

setup() {
  unit_setup
  export HOME="$TEST_TMP"
  mkdir -p "$HOME/.roll/.peer-state/logs"
  _PEER_STATE_DIR="$HOME/.roll/.peer-state"
}

teardown() { unit_teardown; }

@test "cmd_peer_log: empty logs dir shows friendly message" {
  run cmd_peer_log
  [ "$status" -eq 0 ]
  [[ "$output" == *"No peer review logs"* ]] || [[ "$output" == *"暂无 peer review 日志"* ]]
}

@test "cmd_peer_log: shows last markdown log by default" {
  local logs_dir="$_PEER_STATE_DIR/logs"
  echo "# Log A" > "$logs_dir/20260531_120000_claude_kimi.md"
  echo "# Log B" > "$logs_dir/20260531_130000_claude_kimi.md"
  run cmd_peer_log
  [ "$status" -eq 0 ]
  [[ "$output" == *"Log B"* ]]
  [[ "$output" != *"Log A"* ]]
}

@test "cmd_peer_log: N argument shows last N logs" {
  local logs_dir="$_PEER_STATE_DIR/logs"
  echo "# Log A" > "$logs_dir/20260531_120000_claude_kimi.md"
  echo "# Log B" > "$logs_dir/20260531_130000_claude_kimi.md"
  run cmd_peer_log 2
  [ "$status" -eq 0 ]
  [[ "$output" == *"Log B"* ]]
  [[ "$output" == *"Log A"* ]]
}

@test "cmd_peer_log: ignores .last_stderr.log" {
  local logs_dir="$_PEER_STATE_DIR/logs"
  echo "stderr noise" > "$logs_dir/.last_stderr.log"
  run cmd_peer_log
  [ "$status" -eq 0 ]
  [[ "$output" == *"No peer review logs"* ]] || [[ "$output" == *"暂无 peer review 日志"* ]]
}
