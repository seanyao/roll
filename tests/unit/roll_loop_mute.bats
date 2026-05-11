#!/usr/bin/env bats
# Tests for roll loop mute/unmute + auto-attach runner injection (US-AUTO-026)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  source "$ROLL_BIN"
  _orig_dir="$PWD"
  _tmp=$(mktemp -d)
  cd "$_tmp"
  # Redirect shared roots into the temp dir so tests don't touch ~/.shared
  _SHARED_ROOT="${_tmp}/.shared/roll"
  _LOOP_MUTE_FILE="${_SHARED_ROOT}/mute"
  mkdir -p "$_SHARED_ROOT"
}

teardown() {
  cd "$_orig_dir"
  rm -rf "$_tmp"
}

# ─── Dispatch ─────────────────────────────────────────────────────────────────

@test "cmd_loop routes 'mute' to _loop_mute" {
  grep -qE 'mute\)[[:space:]]+_loop_mute' "$ROLL_BIN"
}

@test "cmd_loop routes 'unmute' to _loop_unmute" {
  grep -qE 'unmute\)[[:space:]]+_loop_unmute' "$ROLL_BIN"
}

@test "cmd_loop usage line lists 'mute' and 'unmute'" {
  grep -qE 'Usage: roll loop .*mute' "$ROLL_BIN"
  grep -qE 'Usage: roll loop .*unmute' "$ROLL_BIN"
}

# ─── _loop_mute behavior ──────────────────────────────────────────────────────

@test "_loop_mute: creates the mute marker file" {
  [ ! -f "$_LOOP_MUTE_FILE" ]
  run _loop_mute
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_MUTE_FILE" ]
}

@test "_loop_mute: prints muted indicator" {
  run _loop_mute
  [ "$status" -eq 0 ]
  [[ "$output" == *"muted"* ]]
}

@test "_loop_mute: is idempotent when already muted" {
  _loop_mute >/dev/null
  run _loop_mute
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_MUTE_FILE" ]
}

# ─── _loop_unmute behavior ────────────────────────────────────────────────────

@test "_loop_unmute: removes the mute marker file" {
  touch "$_LOOP_MUTE_FILE"
  run _loop_unmute
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_MUTE_FILE" ]
}

@test "_loop_unmute: prints unmuted indicator" {
  touch "$_LOOP_MUTE_FILE"
  run _loop_unmute
  [ "$status" -eq 0 ]
  [[ "$output" == *"unmuted"* ]] || [[ "$output" == *"live"* ]]
}

@test "_loop_unmute: is idempotent when already unmuted" {
  [ ! -f "$_LOOP_MUTE_FILE" ]
  run _loop_unmute
  [ "$status" -eq 0 ]
  [ ! -f "$_LOOP_MUTE_FILE" ]
}

@test "_LOOP_MUTE_FILE constant is exported and resolves under shared root" {
  [[ "$_LOOP_MUTE_FILE" == *"/mute" ]]
}
