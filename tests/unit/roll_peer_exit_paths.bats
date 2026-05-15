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
  TMUX_KILL_LOG="$TEST_TMP/tmux_kill.log"
  : > "$TMUX_KILL_LOG"
  tmux() {
    case "${1:-}" in
      has-session) return 0 ;;
      list-clients) echo "" ;;
      kill-session) echo "$*" >> "$TMUX_KILL_LOG"; return 0 ;;
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

# ─── tmux session cleanup (US-AUTO-039) ──────────────────────────────────────

@test "cmd_peer: AGREE kills tmux session" {
  : > "$TMUX_KILL_LOG"
  _run_peer_with_response "**AGREE** with the approach."
  grep -q "kill-session" "$TMUX_KILL_LOG"
}

@test "cmd_peer: ESCALATE kills tmux session" {
  : > "$TMUX_KILL_LOG"
  _run_peer_with_response "**ESCALATE** this needs human review."
  grep -q "kill-session" "$TMUX_KILL_LOG"
}

@test "cmd_peer: UNKNOWN kills tmux session" {
  : > "$TMUX_KILL_LOG"
  _run_peer_with_response "No resolution keyword here."
  grep -q "kill-session" "$TMUX_KILL_LOG"
}

@test "cmd_peer: REFINE round=3 kills tmux session" {
  : > "$TMUX_KILL_LOG"
  printf '**REFINE** still needs work.\n' > "$PEER_RESPONSE_FILE"
  _peer_call() { cat "$PEER_RESPONSE_FILE"; }
  export -f _peer_call
  run cmd_peer --from claude --to kimi --round 3 --yolo
  grep -q "kill-session" "$TMUX_KILL_LOG"
}

@test "cmd_peer: REFINE round=1 preserves tmux session" {
  : > "$TMUX_KILL_LOG"
  _run_peer_with_response "**REFINE** the error handling needs work."
  if grep -q "kill-session" "$TMUX_KILL_LOG"; then
    echo "# DEBUG: kill-session found in log:" >&2
    cat "$TMUX_KILL_LOG" >&2
    echo "# DEBUG: cmd_peer output was:" >&2
    echo "$output" >&2
    return 1
  fi
}

@test "cmd_peer: OBJECT round=2 preserves tmux session" {
  : > "$TMUX_KILL_LOG"
  printf '**OBJECT** to the proposed change.\n' > "$PEER_RESPONSE_FILE"
  _peer_call() { cat "$PEER_RESPONSE_FILE"; }
  export -f _peer_call
  run cmd_peer --from claude --to kimi --round 2 --yolo
  if grep -q "kill-session" "$TMUX_KILL_LOG"; then
    echo "# DEBUG: kill-session found in log:" >&2
    cat "$TMUX_KILL_LOG" >&2
    echo "# DEBUG: cmd_peer output was:" >&2
    echo "$output" >&2
    return 1
  fi
}

@test "cmd_peer: REFINE round=2 preserves tmux session" {
  : > "$TMUX_KILL_LOG"
  printf '**REFINE** still needs refinement.\n' > "$PEER_RESPONSE_FILE"
  _peer_call() { cat "$PEER_RESPONSE_FILE"; }
  export -f _peer_call
  run cmd_peer --from claude --to kimi --round 2 --yolo
  if grep -q "kill-session" "$TMUX_KILL_LOG"; then
    echo "# DEBUG: kill-session found in log:" >&2
    cat "$TMUX_KILL_LOG" >&2
    echo "# DEBUG: cmd_peer output was:" >&2
    echo "$output" >&2
    return 1
  fi
}

# Regression: FIX-036 — entry-level kill must not fire on round=1 when a session
# already exists (e.g. session preserved from a previous REFINE and then re-invoked).
@test "cmd_peer: existing session not killed at entry when round=1 starts (FIX-036)" {
  : > "$TMUX_KILL_LOG"
  # has-session returns 0 → session already exists (simulates preserved REFINE session)
  # AGREE response → only the exit-path kill should fire; any kill before _peer_call
  # would mean the entry kill regressed.
  # We check the kill count: exactly one kill (at exit for AGREE), not two.
  _run_peer_with_response "**AGREE** with the approach."
  local kills
  kills=$(grep -c "kill-session" "$TMUX_KILL_LOG" || true)
  # Exactly one kill (exit-path for AGREE) — any additional kill = entry-kill regression
  [ "$kills" -eq 1 ]
}
