#!/usr/bin/env bats
# Unit tests for: _notify helper and roll loop notify subcommand (US-NOTIFY-001)

load helpers

setup()    { unit_setup; }
teardown() { unit_teardown; }

# ── _notify helper ────────────────────────────────────────────────────────────

@test "_notify: returns 0 when muted" {
  _LOOP_MUTE_FILE="${TEST_TMP}/mute"
  touch "$_LOOP_MUTE_FILE"
  run _notify "Test Title" "Test body"
  [ "$status" -eq 0 ]
}

@test "_notify: returns 0 when osascript not available" {
  # Simulate non-macOS or no osascript by overriding PATH to empty
  _LOOP_MUTE_FILE="${TEST_TMP}/no-mute-file"
  local orig_path="$PATH"
  # Override uname and osascript by using a temp PATH with a fake uname returning Linux
  local fake_bin="${TEST_TMP}/fake_bin"
  mkdir -p "$fake_bin"
  printf '#!/bin/bash\necho Linux\n' > "${fake_bin}/uname"
  chmod +x "${fake_bin}/uname"
  PATH="${fake_bin}:${PATH}" run _notify "Test" "body"
  PATH="$orig_path"
  [ "$status" -eq 0 ]
}

@test "_notify: returns 0 — function exists" {
  run _notify
  [ "$status" -eq 0 ]
}

# ── roll loop notify CLI ──────────────────────────────────────────────────────

@test "roll loop notify: exits 0 when muted" {
  export HOME="${TEST_TMP}"
  mkdir -p "${TEST_TMP}/.shared/roll"
  touch "${TEST_TMP}/.shared/roll/mute"
  run bash "$ROLL_BIN" loop notify "Story Complete" "US-TEST-001 shipped"
  [ "$status" -eq 0 ]
}

@test "roll loop notify: exits 0 with no arguments" {
  export HOME="${TEST_TMP}"
  mkdir -p "${TEST_TMP}/.shared/roll"
  touch "${TEST_TMP}/.shared/roll/mute"
  run bash "$ROLL_BIN" loop notify
  [ "$status" -eq 0 ]
}
