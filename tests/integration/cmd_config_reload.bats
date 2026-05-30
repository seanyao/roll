#!/usr/bin/env bats
# US-LOOP-036: `roll config <svc>-time` must auto-reload the launchd plists so
# the new schedule lands immediately and `roll loop status` reflects it without
# a manual `roll loop on`. Sandboxed: _LAUNCHD_DIR points at a temp dir and
# _LAUNCHD_SKIP_REGISTRY=1 keeps launchctl off the host. macOS path only —
# launchd plists are macOS; skip on Linux CI.

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  [[ "$(uname)" == "Darwin" ]] || skip "launchd reload tests require macOS (skip on Linux CI)"
  TEST_TMP="$(mktemp -d)"
  export _SHARED_ROOT="${TEST_TMP}/.shared/roll"
  export _LAUNCHD_DIR="${TEST_TMP}/LaunchAgents"
  export _LAUNCHD_SKIP_REGISTRY=1
  export ROLL_HOME="${TEST_TMP}/.roll"
  export ROLL_CONFIG="${ROLL_HOME}/config.yaml"
  export ROLL_SKIP_STRUCTURE_CHECK=1
  mkdir -p "${_SHARED_ROOT}/loop" "${_LAUNCHD_DIR}" "${ROLL_HOME}"
  PROJ="${TEST_TMP}/project"
  mkdir -p "${PROJ}/.roll"
  : > "${PROJ}/.roll/backlog.md"
  ( cd "$PROJ" && git init -q && git config user.email t@t.t && git config user.name T )
}

teardown() { rm -rf "${TEST_TMP:-}"; }

# Run `roll` inside the sandboxed project with all env exported.
roll_in_proj() {
  ( cd "$PROJ" && HOME="$TEST_TMP" \
      _SHARED_ROOT="$_SHARED_ROOT" _LAUNCHD_DIR="$_LAUNCHD_DIR" \
      _LAUNCHD_SKIP_REGISTRY=1 ROLL_HOME="$ROLL_HOME" ROLL_CONFIG="$ROLL_CONFIG" \
      ROLL_SKIP_STRUCTURE_CHECK=1 NO_COLOR=1 \
      bash "$ROLL_BIN" "$@" )
}

dream_plist() {
  # Exactly one dream plist is written for the sandboxed project; resolve it by
  # glob rather than recomputing the slug (sourcing bin/roll here breaks PATH).
  local p
  for p in "${_LAUNCHD_DIR}"/com.roll.dream.*.plist; do
    [[ -f "$p" ]] && { printf '%s\n' "$p"; return 0; }
  done
  return 1
}

@test "US-LOOP-036: roll config dream-time rewrites the dream plist with the new HH:MM" {
  run roll_in_proj config dream-time 03:30
  [ "$status" -eq 0 ]
  local plist; plist="$(dream_plist)"
  [ -f "$plist" ]
  # plist must carry the configured calendar fire time (array-style, US-LOOP-035)
  run cat "$plist"
  [[ "$output" == *"<key>StartCalendarInterval</key>"* ]]
  [[ "$output" == *"<key>Hour</key>"* ]]
  [[ "$output" == *"<integer>3</integer>"* ]]
  [[ "$output" == *"<key>Minute</key>"* ]]
  [[ "$output" == *"<integer>30</integer>"* ]]
}

@test "US-LOOP-036: a follow-up dream-time change updates the plist mtime" {
  roll_in_proj config dream-time 03:30
  local plist; plist="$(dream_plist)"
  [ -f "$plist" ]
  local before; before="$(cat "$plist")"
  # Change to a different time — content must differ (proves a real rewrite).
  run roll_in_proj config dream-time 04:45
  [ "$status" -eq 0 ]
  local after; after="$(cat "$plist")"
  [ "$before" != "$after" ]
  [[ "$after" == *"<integer>4</integer>"* ]]
  [[ "$after" == *"<integer>45</integer>"* ]]
}

@test "US-LOOP-036: roll loop status reflects the freshly-configured dream time" {
  roll_in_proj config dream-time 03:30
  run roll_in_proj loop status --no-color
  [ "$status" -eq 0 ]
  [[ "$output" == *"dream: 03:30"* ]]
}

@test "US-LOOP-036: reload failure does not fail the yaml write (write still succeeds)" {
  # Point _LAUNCHD_DIR at a path that cannot be created (parent is a file) so
  # _install_launchd_plists fails; the config write must still report success.
  : > "${TEST_TMP}/blocker"
  run env HOME="$TEST_TMP" _SHARED_ROOT="$_SHARED_ROOT" \
      _LAUNCHD_DIR="${TEST_TMP}/blocker/LaunchAgents" _LAUNCHD_SKIP_REGISTRY=1 \
      ROLL_HOME="$ROLL_HOME" ROLL_CONFIG="$ROLL_CONFIG" ROLL_SKIP_STRUCTURE_CHECK=1 \
      NO_COLOR=1 bash -c "cd '$PROJ' && bash '$ROLL_BIN' config dream-time 05:15"
  [ "$status" -eq 0 ]
  [[ "$output" == *"set dream-time = 05:15"* ]]
  # yaml is the source of truth — the value must be persisted regardless.
  run grep -q "loop_dream_hour: 5" "$ROLL_CONFIG"
  [ "$status" -eq 0 ]
}
