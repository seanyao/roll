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

  # FIX-096: this file used to `unset _LAUNCHD_SKIP_REGISTRY` and let real
  # `launchctl` handle load/unload/bootstrap/bootout/disable/enable. Each run
  # leaked ~15 com.roll.* override rows into the host's
  # /private/var/db/com.apple.xpc.launchd/disabled.<UID>.plist — the one
  # remaining leak source after FIX-093 plugged the unit side. Replace with a
  # PATH shim that maintains an in-memory state model:
  #   • load/unload/bootstrap/bootout/disable/enable mutate the model
  #   • list / print / print-disabled read from it
  # The shim is sufficient for every assertion in this file because the only
  # things the tests need to *observe* via launchctl are (a) whether a label
  # is loaded (`list "$label"`) and (b) whether the override flag is set
  # (`print-disabled` parsed by bin/roll's `_launchd_is_loaded`).
  _LAUNCHCTL_SHIM_DIR="${TEST_TMP}/launchctl-shim"
  _LAUNCHCTL_SHIM_STATE="${TEST_TMP}/launchctl-shim-state"
  mkdir -p "$_LAUNCHCTL_SHIM_DIR"
  : > "$_LAUNCHCTL_SHIM_STATE"
  cat > "${_LAUNCHCTL_SHIM_DIR}/launchctl" <<'SHIM_EOF'
#!/usr/bin/env bash
# launchctl shim for cmd_loop.bats — see SETUP() comment for rationale.
# State file rows: "LABEL LOADED OVERRIDE"
#   LOADED   ∈ {loaded, unloaded}
#   OVERRIDE ∈ {enabled, disabled, none}
state="${_LAUNCHCTL_SHIM_STATE:?_LAUNCHCTL_SHIM_STATE missing}"
touch "$state"

_label_of_plist() {
  [[ -f "${1:-}" ]] || return 0
  grep -A1 '<key>Label</key>' "$1" 2>/dev/null \
    | grep '<string>' | head -1 \
    | sed 's/.*<string>\([^<]*\)<\/string>.*/\1/'
}

# Upsert one row: LABEL LOADED OVERRIDE. Use '-' to keep current.
_upsert() {
  local lbl="${1:-}" want_loaded="${2:--}" want_override="${3:--}"
  [[ -z "$lbl" ]] && return 0
  local cur_loaded='unloaded' cur_override='none' had_row=
  if [[ -s "$state" ]]; then
    local row
    row=$(awk -v l="$lbl" '$1==l {print $2" "$3; exit}' "$state")
    if [[ -n "$row" ]]; then
      cur_loaded="${row%% *}"
      cur_override="${row##* }"
      had_row=1
    fi
  fi
  [[ "$want_loaded"   == '-' ]] && want_loaded="$cur_loaded"
  [[ "$want_override" == '-' ]] && want_override="$cur_override"
  if [[ -n "$had_row" ]]; then
    grep -v "^${lbl} " "$state" > "${state}.new" 2>/dev/null || :
    mv "${state}.new" "$state"
  fi
  printf '%s %s %s\n' "$lbl" "$want_loaded" "$want_override" >> "$state"
}

_erase() {
  local lbl="${1:-}"
  [[ -z "$lbl" || ! -s "$state" ]] && return 0
  grep -v "^${lbl} " "$state" > "${state}.new" 2>/dev/null || :
  mv "${state}.new" "$state"
}

_is_loaded() {
  [[ -s "$state" ]] || return 1
  awk -v l="${1:-}" '$1==l && $2=="loaded" {f=1; exit} END {exit !f}' "$state"
}

cmd="${1:-}"; shift 2>/dev/null || true
case "$cmd" in
  load)
    if [[ "${1:-}" == "-w" ]]; then shift; ov='enabled'; else ov='-'; fi
    _upsert "$(_label_of_plist "${1:-}")" loaded "$ov"
    ;;
  unload)
    if [[ "${1:-}" == "-w" ]]; then shift; ov='disabled'; else ov='-'; fi
    _upsert "$(_label_of_plist "${1:-}")" unloaded "$ov"
    ;;
  bootstrap)
    # bootstrap <domain> <plist>
    _upsert "$(_label_of_plist "${2:-}")" loaded enabled
    ;;
  bootout)
    # bootout <domain>/<label>  OR  bootout <domain> <plist>
    case "${1:-}" in
      */*/*) _upsert "${1##*/}" unloaded - ;;
      *)     _upsert "$(_label_of_plist "${2:-}")" unloaded - ;;
    esac
    ;;
  disable)
    _upsert "${1##*/}" - disabled
    ;;
  enable)
    _upsert "${1##*/}" - enabled
    ;;
  remove)
    _erase "${1##*/}"
    ;;
  list)
    if [[ -z "${1:-}" ]]; then
      [[ -s "$state" ]] && awk '$2=="loaded" {print $1}' "$state"
      exit 0
    fi
    _is_loaded "$1"; exit $?
    ;;
  print)
    _is_loaded "${1##*/}"; exit $?
    ;;
  print-disabled)
    [[ -s "$state" ]] && awk '$3!="none" {printf "\t\"%s\" => %s\n", $1, $3}' "$state"
    ;;
  kickstart|version|managername|managerpid|hostinfo|limit|reboot|reset|reload|"")
    : # no-op
    ;;
  *)
    printf 'launchctl shim: unhandled "%s"\n' "$cmd" >&2
    ;;
esac
exit 0
SHIM_EOF
  chmod +x "${_LAUNCHCTL_SHIM_DIR}/launchctl"
  export _LAUNCHCTL_SHIM_STATE
  PATH="${_LAUNCHCTL_SHIM_DIR}:$PATH"
  export PATH

  # FIX-096: keep _LAUNCHD_SKIP_REGISTRY=1 inherited from integration_setup.
  # It gates the launchctl calls inside `_install_launchd_plists`; the shim
  # only needs to model the naked launchctl calls in _loop_on/off/pause/resume.

  # Pre-install plists via setup so loop on/off have files to work with
  run_roll setup
}

teardown() {
  # FIX-096: with the launchctl PATH shim in place, no real `launchctl unload`
  # is needed at teardown — the shim's state file is inside TEST_TMP and gets
  # removed by `integration_teardown`. Keep the loop here as a no-op safety
  # net in case future tests temporarily disable the shim.
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
  # Three-state display (US-AUTO-015 / FIX-095):
  # not installed | installed/off | enabled
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

@test "loop runner script contains auto-attach popup with mute check" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS-only auto-attach path"

  # FIX-096: post-FIX-078, `cmd_setup` no longer installs plists/runners —
  # plist+runner generation now lives exclusively in `_loop_on`. So the outer
  # test-suite `run_roll setup` is not enough to materialize the runner; flip
  # the loop on here to make it appear.
  run_roll loop on

  # `loop on` writes both an outer runner (run-<slug>.sh, contains tmux + popup)
  # and an inner runner (run-<slug>-inner.sh, contains the agent command).
  # Pick the outer one only.
  local runner=""
  for f in "${TEST_TMP}/.shared/roll/loop/run-"*.sh; do
    [[ -f "$f" && "$f" != *-inner.sh ]] && runner="$f" && break
  done
  [ -n "$runner" ]
  [ -f "$runner" ]

  # FIX-092: popup uses `open -g -a Terminal <.command>` (background, no focus
  # steal); replaces a prior osascript dance that triggered "where is <app>"
  # dialogs on bundle-name vs process-name mismatch (e.g. MSTeams).
  grep -qF 'open -g -a Terminal' "$runner"
  # FIX-052: mute is per-project (.shared/roll/loop/mute-<slug>).
  grep -qE '\.shared/roll/loop/mute-' "$runner"
  grep -qF 'tmux attach' "$runner"
}
