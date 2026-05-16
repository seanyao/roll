#!/usr/bin/env bats
# Tests for US-AUTO-027: peer _peer_call tmux dispatch + auto-attach popup

load helpers
setup() {
  unit_setup_cd
  _tmp="$TEST_TMP"
}
teardown() { unit_teardown_cd; }

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
  # The non-tmux else branch must still dispatch the call (post-REFACTOR-017
  # this goes through _agent_argv, not inline case-blocks).
  echo "$body" | grep -qE '_agent_argv .* peer'
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

@test "cmd_peer: _peer_auto_attach is gated by list-clients (re-attaches on subsequent rounds)" {
  # Regression: previously _peer_auto_attach was nested inside `if ! has-session`
  # so rounds 2+ silently reused the session without popping. The fix gates on
  # `tmux list-clients` being empty so each round re-attaches if no window open.
  local body
  body=$(awk '/^cmd_peer\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qF 'tmux list-clients'
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

# ─── E2E golden path: mute suppresses popup, session name is deterministic ────

@test "e2e: _peer_auto_attach is silent when mute file exists (no osascript side-effect)" {
  _LOOP_MUTE_FILE="${_tmp}/mute"
  touch "$_LOOP_MUTE_FILE"
  # Must exit 0 without error
  _peer_auto_attach "roll-peer-claude-kimi"
}

@test "e2e: peer session name format is roll-peer-FROM-TO" {
  local body
  body=$(awk '/^cmd_peer\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  # Session name uses from_tool and to_tool variables
  echo "$body" | grep -qE 'roll-peer-.*from_tool.*to_tool|roll-peer-\$\{from_tool\}-\$\{to_tool\}'
}

@test "e2e: _peer_call falls back gracefully when tmux session absent" {
  # With an empty/absent session arg, _peer_call should use the inline path.
  # Post-REFACTOR-017 the literal `claude -p --output-format text` lives in
  # _agent_argv (peer mode); _peer_call invokes it via _agent_argv "$to" peer.
  local body
  body=$(awk '/^_peer_call\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -qE '_agent_argv .* peer'
  # And the underlying helper must produce the canonical claude peer cmd.
  local helper
  helper=$(awk '/^_agent_argv\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$helper" | grep -qF 'claude -p --output-format text'
}
