#!/usr/bin/env bats
# Unit tests for FIX-150a: roll peer runs structured record query.

load helpers

setup() {
  unit_setup
  export HOME="$TEST_TMP"
  mkdir -p "$HOME/.roll/.peer-state/logs"
  _PEER_STATE_DIR="$HOME/.roll/.peer-state"
}

teardown() { unit_teardown; }

@test "cmd_peer_runs: empty ledger shows friendly message" {
  run cmd_peer_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"No peer review runs"* ]] || [[ "$output" == *"暂无 peer review 记录"* ]]
}

@test "cmd_peer_runs: shows last 10 records by default" {
  local ledger="$_PEER_STATE_DIR/peer-runs.jsonl"
  for i in 1 2 3; do
    printf '{"ts":"2026-05-31T12:00:0%sz","from":"claude","to":"kimi","round":1,"tag":"test","verdict":"AGREE","duration_sec":%s,"pair":"claude→kimi"}\n' "$i" "$i" >> "$ledger"
  done
  run cmd_peer_runs
  [ "$status" -eq 0 ]
  [[ "$output" == *"AGREE"* ]]
  [[ "$output" == *"claude"* ]]
  [[ "$output" == *"kimi"* ]]
}

@test "cmd_peer_runs: N argument limits output" {
  local ledger="$_PEER_STATE_DIR/peer-runs.jsonl"
  for i in 1 2 3; do
    printf '{"ts":"2026-05-31T12:00:0%sz","from":"claude","to":"kimi","round":1,"tag":"test","verdict":"AGREE","duration_sec":%s,"pair":"claude→kimi"}\n' "$i" "$i" >> "$ledger"
  done
  run cmd_peer_runs 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"12:00:03"* ]]
  [[ "$output" != *"12:00:02"* ]]
}

@test "cmd_peer: writes ledger record after completion" {
  local ledger="$_PEER_STATE_DIR/peer-runs.jsonl"

  # Stub tmux and auto-attach
  tmux() { return 0; }
  export -f tmux
  _peer_auto_attach() { :; }
  export -f _peer_auto_attach

  # Stub peer call to return AGREE
  _peer_call() { echo "**AGREE**"; }
  export -f _peer_call

  run cmd_peer --from claude --to kimi --yolo
  [ "$status" -eq 0 ]
  [ -f "$ledger" ]
  local count
  count=$(wc -l < "$ledger" | tr -d ' ')
  [ "$count" -eq 1 ]
  [[ "$(cat "$ledger")" == *"claude"* ]]
  [[ "$(cat "$ledger")" == *"kimi"* ]]
  [[ "$(cat "$ledger")" == *"AGREE"* ]]
}
