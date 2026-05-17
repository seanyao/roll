#!/usr/bin/env bats
# Integration tests for: roll loop on/off/status (macOS launchd path)

load helpers

setup() {
  integration_setup
  # Pre-install plists via setup so loop on/off have files to work with
  run_roll setup
}

teardown() {
  # Unload any plists the test may have loaded, best-effort
  local launchd_dir="${TEST_TMP}/Library/LaunchAgents"
  if [[ -d "$launchd_dir" ]]; then
    for plist in "${launchd_dir}"/com.roll.*.plist; do
      [[ -f "$plist" ]] && launchctl unload "$plist" &>/dev/null || true
    done
  fi
  integration_teardown
}

# ─── loop on / off (macOS launchd) ───────────────────────────────────────────

@test "loop on (macOS): exits 0" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  run_roll loop on
  [ "$status" -eq 0 ]
}

@test "loop on (macOS): loads the loop launchd service" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"

  run_roll loop on
  [ "$status" -eq 0 ]

  # Derive label from plist filename
  local launchd_dir="${TEST_TMP}/Library/LaunchAgents"
  local loop_plist; loop_plist=$(find "$launchd_dir" -name "com.roll.loop.*.plist" | head -1)
  [ -n "$loop_plist" ]
  local label; label=$(grep -A1 '<key>Label</key>' "$loop_plist" | grep '<string>' | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
  launchctl list "$label" &>/dev/null
}

@test "loop on (macOS): idempotent — running twice does not error" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  run_roll loop on
  [ "$status" -eq 0 ]
  run_roll loop on
  [ "$status" -eq 0 ]
}

@test "loop off (macOS): unloads services after loop on" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"

  run_roll loop on
  [ "$status" -eq 0 ]
  run_roll loop off
  [ "$status" -eq 0 ]

  local launchd_dir="${TEST_TMP}/Library/LaunchAgents"
  local loop_plist; loop_plist=$(find "$launchd_dir" -name "com.roll.loop.*.plist" | head -1)
  [ -n "$loop_plist" ]
  local label; label=$(grep -A1 '<key>Label</key>' "$loop_plist" | grep '<string>' | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
  ! launchctl list "$label" &>/dev/null
}

@test "loop off (macOS): warns when not enabled" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  run_roll loop off
  [ "$status" -eq 0 ]
  [[ "$output" == *"not enabled"* ]] || [[ "$output" == *"未启用"* ]]
}

@test "loop status (macOS): shows off-state when not loaded" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  run_roll loop status
  [ "$status" -eq 0 ]
  # Three-state display (US-AUTO-015): not installed | installed/off | enabled
  [[ "$output" == *"not installed"* ]] || [[ "$output" == *"installed/off"* ]] || [[ "$output" == *"未启用"* ]]
}

@test "loop status (macOS): shows enabled after loop on" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  run_roll loop on
  run_roll loop status
  [ "$status" -eq 0 ]
  [[ "$output" == *"enabled"* ]] || [[ "$output" == *"已启用"* ]]
}

# ─── loop mute / unmute (US-AUTO-026 golden path E2E) ────────────────────────

@test "loop mute → unmute round-trip: file appears then disappears" {
  # FIX-052: per-project mute path (was global ${HOME}/.shared/roll/mute).
  local mute_file; mute_file=$(roll_loop_path mute)

  [ ! -f "$mute_file" ]

  run_roll loop mute
  [ "$status" -eq 0 ]
  [[ "$output" == *"muted"* ]] || [[ "$output" == *"已静音"* ]]
  [ -f "$mute_file" ]

  run_roll loop status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Auto-attach"* ]]
  [[ "$output" == *"muted"* ]]

  run_roll loop unmute
  [ "$status" -eq 0 ]
  [[ "$output" == *"unmuted"* ]] || [[ "$output" == *"已恢复"* ]]
  [ ! -f "$mute_file" ]

  run_roll loop status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Auto-attach"* ]]
  [[ "$output" == *"live"* ]]
}

@test "loop runner script contains auto-attach osascript with mute check" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS-only auto-attach path"

  # Setup writes both an outer runner (run-<slug>.sh, contains tmux + osascript)
  # and an inner runner (run-<slug>-inner.sh, contains the agent command).
  # Pick the outer one only.
  local runner=""
  for f in "${TEST_TMP}/.shared/roll/loop/run-"*.sh; do
    [[ -f "$f" && "$f" != *-inner.sh ]] && runner="$f" && break
  done
  [ -n "$runner" ]
  [ -f "$runner" ]

  grep -qF 'osascript' "$runner"
  # FIX-052: mute is per-project (.shared/roll/loop/mute-<slug>).
  grep -qE '\.shared/roll/loop/mute-' "$runner"
  grep -qF 'tmux attach' "$runner"
}
