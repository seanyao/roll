#!/usr/bin/env bats
# FIX-148 (owner decision B): daily (dream/brief) services DEFAULT to the FIX-105
# known-good StartInterval=86400 workaround, because macOS 26.x launchd SILENTLY
# refuses to FIRE a StartCalendarInterval carrying Hour+Minute (so dream/brief
# never run). The array-style StartCalendarInterval (US-LOOP-035) is UNVERIFIED
# on macOS 26.x and is an explicit OPT-IN only: set ROLL_DREAM_CALENDAR=1 to emit
# it. These tests cover BOTH paths (default=86400, opt-in=array).
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

@test "daily plist: defaults to StartInterval=86400 (FIX-148 known-good)" {
  run _write_launchd_plist "$PLIST" "com.roll.dream.test" "$PROJ" "60" "20" "3" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartInterval</key>"* ]]
  [[ "$output" == *"<integer>86400</integer>"* ]]
  # the unverified array-style calendar form must NOT be emitted by default
  [[ "$output" != *"StartCalendarInterval"* ]]
  [[ "$output" != *"<key>Hour</key>"* ]]
}

@test "daily plist: ROLL_DREAM_CALENDAR=1 opts into array-style StartCalendarInterval" {
  ROLL_DREAM_CALENDAR=1 run _write_launchd_plist "$PLIST" "com.roll.dream.test" "$PROJ" "60" "20" "3" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartCalendarInterval</key>"* ]]
  [[ "$output" == *"<array>"* ]]
  [[ "$output" == *"<key>Hour</key>"* ]]
  [[ "$output" == *"<integer>3</integer>"* ]]
  [[ "$output" == *"<key>Minute</key>"* ]]
  [[ "$output" == *"<integer>20</integer>"* ]]
  # opt-in path must NOT carry the default 86400 interval
  [[ "$output" != *"<integer>86400</integer>"* ]]
}

@test "non-daily plist: empty hour keeps StartInterval = period*60" {
  run _write_launchd_plist "$PLIST" "com.roll.loop.test" "$PROJ" "30" "7" "" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartInterval</key>"* ]]
  [[ "$output" == *"<integer>1800</integer>"* ]]
  [[ "$output" != *"StartCalendarInterval"* ]]
}

@test "daily plist (opt-in): minute defaults to 0 when offset is empty" {
  ROLL_DREAM_CALENDAR=1 run _write_launchd_plist "$PLIST" "com.roll.dream.test" "$PROJ" "60" "" "5" "$RUNNER"
  [ "$status" -eq 0 ]
  run cat "$PLIST"
  [[ "$output" == *"<key>StartCalendarInterval</key>"* ]]
  [[ "$output" == *"<key>Hour</key>"* ]]
  [[ "$output" == *"<integer>5</integer>"* ]]
  [[ "$output" == *"<key>Minute</key>"* ]]
  [[ "$output" == *"<integer>0</integer>"* ]]
}
