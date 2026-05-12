#!/usr/bin/env bats
# Tests for FIX-028: cmd_peer must not crash with "resolution: unbound variable"
# on any resolution outcome. Covers AGREE/REFINE/OBJECT/ESCALATE/UNKNOWN exit paths.

load helpers

setup() {
  unit_setup
  export HOME="$TEST_TMP"
  mkdir -p "$HOME/.shared/roll/peer/logs"
  _PEER_STATE_DIR="$HOME/.shared/roll/peer"

  # Stub tmux so cmd_peer's tmux session creation succeeds without side effects.
  tmux() {
    case "${1:-}" in
      has-session) return 1 ;;
      list-clients) echo "" ;;
      *) return 0 ;;
    esac
  }
  export -f tmux

  # Suppress real popup.
  _peer_auto_attach() { :; }
  export -f _peer_auto_attach

  # File-based stub for peer response (avoids variable shadowing across
  # function scopes that would itself trip set -u on bash 3.2).
  PEER_RESPONSE_FILE="$TEST_TMP/peer_response.txt"
}

teardown() { unit_teardown; }

_run_peer_with_response() {
  local response_text="$1"
  printf '%s\n' "$response_text" > "$PEER_RESPONSE_FILE"
  _peer_call() { cat "$PEER_RESPONSE_FILE"; }
  export -f _peer_call
  run cmd_peer --from claude --to kimi --yolo
  [[ "$output" != *"unbound variable"* ]] || {
    echo "FAIL: unbound variable detected in output" >&2
    echo "$output" >&2
    return 1
  }
}

@test "cmd_peer: AGREE response exits 0 without unbound error" {
  _run_peer_with_response "**AGREE** with the approach after review."
  [ "$status" -eq 0 ]
}

@test "cmd_peer: REFINE response exits 2 without unbound error" {
  _run_peer_with_response "**REFINE** the error handling needs work."
  [ "$status" -eq 2 ]
}

@test "cmd_peer: OBJECT response exits 2 without unbound error" {
  _run_peer_with_response "**OBJECT** to the proposed change."
  [ "$status" -eq 2 ]
}

@test "cmd_peer: ESCALATE response exits 1 without unbound error" {
  _run_peer_with_response "**ESCALATE** this needs human review."
  [ "$status" -eq 1 ]
}

@test "cmd_peer: unparseable response (UNKNOWN) exits 1 without unbound error" {
  _run_peer_with_response "This response has no resolution keyword at all."
  [ "$status" -eq 1 ]
}

@test "cmd_peer: REFINE prints 'continue to round' message on round 1" {
  _run_peer_with_response "**REFINE** needs work."
  [[ "$output" == *"Continue to round 2"* ]]
}

@test "cmd_peer: round=3 with REFINE escalates instead of incrementing" {
  printf '**REFINE** still needs work.\n' > "$PEER_RESPONSE_FILE"
  _peer_call() { cat "$PEER_RESPONSE_FILE"; }
  export -f _peer_call
  run cmd_peer --from claude --to kimi --round 3 --yolo
  [[ "$output" != *"unbound variable"* ]]
  [[ "$output" == *"Max rounds reached"* ]]
  [ "$status" -eq 2 ]
}
