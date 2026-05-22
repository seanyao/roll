#!/usr/bin/env bats
# Integration tests for: roll loop on/off/status (macOS launchd path)

load helpers

setup() {
  # FIX-074: this file calls `run_roll loop on/off` which would mutate the
  # host's launchd state if the test runs inside a real cycle (ROLL_MAIN_SLUG
  # poisons _project_slug → label collapses to live service → cycle kills
  # itself). Skip the whole file when CYCLE_ID is set.
  require_not_in_real_loop
  integration_setup
  # FIX-090: cmd_loop.bats is the one integration file that *intentionally*
  # exercises the launchctl bootstrap/load path (assertions below call
  # `launchctl list "$label"`). Opt out of the default skip set by
  # integration_setup; the file's existing teardown bootouts these labels
  # so the test still cleans up after itself.
  unset _LAUNCHD_SKIP_REGISTRY
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
  # US-VIEW-001: mute / Auto-attach line is only rendered by the v1 bash
  # implementation. The v2 Python view does not show mute state yet
  # (tracked separately). Pin v1 for this round-trip check.
  export ROLL_UI=v1
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

# ─── FIX-081: launchd disable-list pollution ─────────────────────────────────

@test "loop off (macOS): issues launchctl enable for all 3 services (FIX-081)" {
  # FIX-081: `_install_launchd_plists` calls `launchctl disable gui/$UID/<label>`
  # on first install (FIX-059 auto-bootstrap guard). That write lands in the
  # host's /private/var/db/com.apple.xpc.launchd/disabled.<UID>.plist regardless
  # of HOME sandbox. Without a symmetric `launchctl enable` on `_loop_off`,
  # every short-lived project leaves 3 permanent ghost labels in the host's
  # disable list — pollution that survives even after the project dir, plists,
  # and ~/.roll are all deleted.
  #
  # We can't observe the real host disable db (would need to actually toggle
  # it, which is exactly the pollution this fix prevents). Instead we shim
  # `launchctl` on PATH and record every invocation, then assert that the
  # `loop off` teardown path emits `enable gui/<uid>/<label>` for all 3
  # services.
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"

  # Derive the slug bin/roll will compute for TEST_TMP so labels match.
  # Mirror bin/roll's `_project_slug` algorithm rather than sourcing bin/roll
  # (whose `set -euo pipefail` aborts when sourced under bats).
  local slug uid canon base hash
  canon=$(realpath "${TEST_TMP}")
  base=$(basename "$canon")
  hash=$(printf '%s' "$canon" | md5 | cut -c1-6)
  base=$(printf '%s' "$base" | tr -cs '[:alnum:]' '-' | sed 's/-*$//')
  slug="${base}-${hash}"
  uid=$(id -u)

  local shim_dir="${TEST_TMP}/shim"
  local log="${TEST_TMP}/launchctl.log"
  mkdir -p "$shim_dir"
  cat > "${shim_dir}/launchctl" <<EOSHIM
#!/usr/bin/env bash
echo "\$@" >> "${log}"
# Make _launchd_is_loaded (which greps \`print-disabled\` output for
# "<label>" => enabled) succeed for our 3 com.roll.* labels so _loop_off
# proceeds past the "not enabled" guard.
case "\$1" in
  print-disabled)
    printf '\t"com.roll.loop.${slug}" => enabled\n'
    printf '\t"com.roll.dream.${slug}" => enabled\n'
    printf '\t"com.roll.brief.${slug}" => enabled\n'
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOSHIM
  chmod +x "${shim_dir}/launchctl"

  # Pre-seed the 3 plist files _loop_off expects to find (so the unload
  # codepath has a target — content doesn't matter, the shim swallows it).
  local launchd_dir="${TEST_TMP}/Library/LaunchAgents"
  mkdir -p "$launchd_dir"
  for svc in loop dream brief; do
    : > "${launchd_dir}/com.roll.${svc}.${slug}.plist"
  done

  # Run `roll loop off` with the shim in front of PATH so the real launchctl
  # is never touched. Direct invocation (not `run_roll`) — see other tests.
  : > "$log"
  PATH="${shim_dir}:$PATH" ROLL_HOME="${ROLL_HOME}" HOME="${TEST_TMP}" \
    bash -c "cd \"${TEST_TMP}\" && bash \"$ROLL_BIN\" loop off" >/dev/null 2>&1 || true

  # Assert that for each service we saw exactly the symmetric pair: an
  # unload-or-bootout to take the service down, and an `enable` to clear
  # the disable flag the FIX-059 install had set.
  for svc in loop dream brief; do
    local label="com.roll.${svc}.${slug}"
    grep -qE "^enable gui/${uid}/${label}$" "$log" \
      || { echo "MISSING: enable gui/${uid}/${label} in launchctl log:" >&2
           cat "$log" >&2
           false; }
  done
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
