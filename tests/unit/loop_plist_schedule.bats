#!/usr/bin/env bats
# US-LOOP-032: launchd plist generation uses StartInterval for all loop services

setup() {
  export _LAUNCHD_SKIP_REGISTRY=1
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  source "${BATS_TEST_DIRNAME}/../../bin/roll"
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
  _LAUNCHD_DIR="$(mktemp -d)"
  export _LAUNCHD_DIR
}

teardown() {
  rm -rf "$_LAUNCHD_DIR"
}

# ─── Helper: call _write_launchd_plist with schedule params ──────────────────

# Writes a loop plist with given period. hour="" triggers the
# StartInterval path (not StartInterval=86400 for daily services).
_write_loop_plist() {
  local plist="$1" label="$2" project="$3" period="$4" offset="$5" runner="$6"
  _write_launchd_plist "$plist" "$label" "$project" "$period" "$offset" "" "$runner"
}

# ─── US-LOOP-032: StartInterval = period * 60 for all loop periods ───────────

@test "_write_launchd_plist: period=60 generates StartInterval=3600" {
  local plist="${_LAUNCHD_DIR}/loop-60.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "60" "18" "/tmp/runner.sh"
  [ -f "$plist" ]

  # Must use StartInterval, not StartCalendarInterval
  grep -q 'StartInterval' "$plist"
  grep -q '<integer>3600</integer>' "$plist"
  ! grep -q 'StartCalendarInterval' "$plist"
}

@test "_write_launchd_plist: period=30 generates StartInterval=1800" {
  local plist="${_LAUNCHD_DIR}/loop-30.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "30" "0" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q 'StartInterval' "$plist"
  grep -q '<integer>1800</integer>' "$plist"
  ! grep -q 'StartCalendarInterval' "$plist"
}

@test "_write_launchd_plist: period=15 generates StartInterval=900" {
  local plist="${_LAUNCHD_DIR}/loop-15.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "15" "0" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q 'StartInterval' "$plist"
  grep -q '<integer>900</integer>' "$plist"
  ! grep -q 'StartCalendarInterval' "$plist"
}

# ─── US-LOOP-032: non-divisor periods ────────────────────────────────────────

@test "_write_launchd_plist: period=45 generates StartInterval=2700" {
  local plist="${_LAUNCHD_DIR}/loop-45.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "45" "0" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q 'StartInterval' "$plist"
  grep -q '<integer>2700</integer>' "$plist"
  ! grep -q 'StartCalendarInterval' "$plist"
}

@test "_write_launchd_plist: period=40 generates StartInterval=2400" {
  local plist="${_LAUNCHD_DIR}/loop-40.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "40" "0" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q 'StartInterval' "$plist"
  grep -q '<integer>2400</integer>' "$plist"
  ! grep -q 'StartCalendarInterval' "$plist"
}

@test "_write_launchd_plist: period=90 generates StartInterval=5400" {
  local plist="${_LAUNCHD_DIR}/loop-90.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "90" "0" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q 'StartInterval' "$plist"
  grep -q '<integer>5400</integer>' "$plist"
  ! grep -q 'StartCalendarInterval' "$plist"
}

# ─── Daily services default to StartInterval=86400; array is opt-in (FIX-148) ─

@test "_write_launchd_plist: daily service (hour present) defaults to StartInterval=86400" {
  local plist="${_LAUNCHD_DIR}/dream-daily.plist"
  _write_launchd_plist "$plist" "com.roll.dream.test" "$PWD" "60" "18" "3" "/tmp/runner.sh"
  [ -f "$plist" ]

  # FIX-148 (owner decision B): daily services default to the FIX-105 known-good
  # StartInterval=86400 workaround, because macOS 26.x launchd silently refuses
  # to fire a StartCalendarInterval carrying Hour+Minute. The array-style form is
  # unverified and opt-in only (ROLL_DREAM_CALENDAR=1).
  grep -q 'StartInterval' "$plist"
  grep -q '<integer>86400</integer>' "$plist"
  ! grep -q 'StartCalendarInterval' "$plist"
}

@test "_write_launchd_plist: ROLL_DREAM_CALENDAR=1 opts into array StartCalendarInterval" {
  local plist="${_LAUNCHD_DIR}/dream-calendar.plist"
  ROLL_DREAM_CALENDAR=1 _write_launchd_plist "$plist" "com.roll.dream.test" "$PWD" "60" "18" "3" "/tmp/runner.sh"
  [ -f "$plist" ]
  grep -q 'StartCalendarInterval' "$plist"
  grep -q '<integer>3</integer>' "$plist"   # Hour
  grep -q '<integer>18</integer>' "$plist"  # Minute
  ! grep -q '<integer>86400</integer>' "$plist"
}

# ─── plutil -lint integration test ───────────────────────────────────────────

@test "_write_launchd_plist: generated plist passes plutil -lint" {
  if ! command -v plutil >/dev/null 2>&1; then
    skip "plutil not available"
  fi

  local plist="${_LAUNCHD_DIR}/loop-lint.plist"
  _write_loop_plist "$plist" "com.roll.loop.lint" "$PWD" "15" "0" "/tmp/runner.sh"
  run plutil -lint "$plist"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

# ─── US-LOOP-032: StartInterval value = period * 60 for various periods ─────

@test "_write_launchd_plist: StartInterval value matches period*60" {
  for period in 60 45 30 20 15 12 10 6 5 1; do
    local plist="${_LAUNCHD_DIR}/loop-si-${period}.plist"
    _write_loop_plist "$plist" "com.roll.loop.si" "$PWD" "$period" "0" "/tmp/runner.sh"
    local expected=$(( period * 60 ))
    grep -q "<integer>${expected}</integer>" "$plist"
    rm -f "$plist"
  done
}
