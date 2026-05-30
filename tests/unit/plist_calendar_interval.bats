#!/usr/bin/env bats
# US-LOOP-035 (resolves FIX-105): _write_launchd_plist must render daily
# (dream/brief) services with an array-style StartCalendarInterval carrying
# Hour + Minute, so launchd fires at the exact configured HH:MM instead of the
# legacy StartInterval=86400 drift. ROLL_DREAM_LEGACY_INTERVAL=1 keeps the old
# workaround as a rollback channel.
#
# _write_launchd_plist signature:
#   <plist_path> <label> <project_path> <period> <offset> <hour> <runner>
# For daily services the fire minute is passed in <offset> and the fire hour in
# <hour>; non-daily (loop) services pass an empty <hour>.

setup() {
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"

  TESTDIR="$(mktemp -d)"
  PLIST="${TESTDIR}/com.roll.dream.test.plist"
  RUNNER="${TESTDIR}/run.sh"
  PROJ="${TESTDIR}/project"
  mkdir -p "$PROJ"
}

teardown() {
  rm -rf "$TESTDIR"
}

@test "daily plist: hour=3 minute=20 renders array-style StartCalendarInterval" {
  run _write_launchd_plist "$PLIST" "com.roll.dream.test" "$PROJ" "60" "20" "3" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartCalendarInterval</key>"* ]]
  [[ "$output" == *"<array>"* ]]
  [[ "$output" == *"<key>Hour</key>"* ]]
  [[ "$output" == *"<integer>3</integer>"* ]]
  [[ "$output" == *"<key>Minute</key>"* ]]
  [[ "$output" == *"<integer>20</integer>"* ]]
  # must NOT fall back to the legacy 86400 workaround
  [[ "$output" != *"<integer>86400</integer>"* ]]
}

@test "daily plist: ROLL_DREAM_LEGACY_INTERVAL=1 restores StartInterval=86400" {
  ROLL_DREAM_LEGACY_INTERVAL=1 run _write_launchd_plist "$PLIST" "com.roll.dream.test" "$PROJ" "60" "20" "3" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartInterval</key>"* ]]
  [[ "$output" == *"<integer>86400</integer>"* ]]
  [[ "$output" != *"StartCalendarInterval"* ]]
}

@test "non-daily plist: empty hour keeps StartInterval = period*60" {
  run _write_launchd_plist "$PLIST" "com.roll.loop.test" "$PROJ" "30" "7" "" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartInterval</key>"* ]]
  [[ "$output" == *"<integer>1800</integer>"* ]]
  [[ "$output" != *"StartCalendarInterval"* ]]
}

@test "daily plist: minute defaults to 0 when offset is empty" {
  run _write_launchd_plist "$PLIST" "com.roll.dream.test" "$PROJ" "60" "" "5" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartCalendarInterval</key>"* ]]
  [[ "$output" == *"<key>Hour</key>"* ]]
  [[ "$output" == *"<integer>5</integer>"* ]]
  [[ "$output" == *"<key>Minute</key>"* ]]
  [[ "$output" == *"<integer>0</integer>"* ]]
}
