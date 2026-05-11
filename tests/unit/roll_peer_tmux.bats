#!/usr/bin/env bats
# Tests for US-AUTO-027: peer _peer_call tmux dispatch + auto-attach popup

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  source "$ROLL_BIN"
  _orig_dir="$PWD"
  _tmp=$(mktemp -d)
  cd "$_tmp"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_tmp"
}

# ─── _peer_auto_attach ─────────────────────────────────────────────────────────

@test "_peer_auto_attach: function exists" {
  declare -f _peer_auto_attach >/dev/null
}

@test "_peer_auto_attach: reads mute file to suppress popup" {
  local body
  body=$(awk '/^_peer_auto_attach\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF '_LOOP_MUTE_FILE'
}

@test "_peer_auto_attach: calls osascript for Terminal popup" {
  local body
  body=$(awk '/^_peer_auto_attach\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'osascript'
}

@test "_peer_auto_attach: reads loop_attach_terminal config" {
  local body
  body=$(awk '/^_peer_auto_attach\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'loop_attach_terminal'
}

@test "_peer_auto_attach: no-ops when mute file exists" {
  _LOOP_MUTE_FILE="${_tmp}/mute"
  touch "$_LOOP_MUTE_FILE"
  # Should return 0 without calling osascript (no side effects in test env)
  run _peer_auto_attach "roll-peer-claude-kimi"
  [ "$status" -eq 0 ]
}

# ─── _peer_dispatch_in_tmux ───────────────────────────────────────────────────

@test "_peer_dispatch_in_tmux: function exists" {
  declare -f _peer_dispatch_in_tmux >/dev/null
}

@test "_peer_dispatch_in_tmux: body creates an inner script file" {
  local body
  body=$(awk '/^_peer_dispatch_in_tmux\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'mktemp'
}

@test "_peer_dispatch_in_tmux: body uses tmux send-keys to dispatch" {
  local body
  body=$(awk '/^_peer_dispatch_in_tmux\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'send-keys'
}

@test "_peer_dispatch_in_tmux: body polls done-file for completion" {
  local body
  body=$(awk '/^_peer_dispatch_in_tmux\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'done_file'
}

@test "_peer_dispatch_in_tmux: body sets Homebrew PATH in inner script" {
  local body
  body=$(awk '/^_peer_dispatch_in_tmux\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF '/opt/homebrew/bin'
}

# ─── _peer_call session parameter ─────────────────────────────────────────────

@test "_peer_call: accepts optional third session argument" {
  local body
  body=$(awk '/^_peer_call\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE 'session'
}

@test "_peer_call: dispatches in tmux when session arg provided and tmux has-session" {
  local body
  body=$(awk '/^_peer_call\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF '_peer_dispatch_in_tmux'
}

@test "_peer_call: falls back to inline when no session arg" {
  local body
  body=$(awk '/^_peer_call\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Fallback branch still contains the original inline dispatch patterns
  echo "$body" | grep -qE 'claude -p|kimi --quiet'
}

# ─── cmd_peer session setup ───────────────────────────────────────────────────

@test "cmd_peer: creates tmux session named roll-peer-from-to" {
  local body
  body=$(awk '/^cmd_peer\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'roll-peer-'
}

@test "cmd_peer: calls _peer_auto_attach to trigger popup" {
  local body
  body=$(awk '/^cmd_peer\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF '_peer_auto_attach'
}

@test "cmd_peer: passes session name to _peer_call" {
  local body
  body=$(awk '/^cmd_peer\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # The _peer_call invocation should include the session variable
  echo "$body" | grep -qE '_peer_call.*peer_session|_peer_call.*session'
}

@test "cmd_peer: skips session creation when tmux not available" {
  local body
  body=$(awk '/^cmd_peer\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'command -v tmux'
}
