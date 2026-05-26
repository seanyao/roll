#!/usr/bin/env bats
# US-LOOP-012: launchd plist generation for multi-trigger schedules

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

# Writes a loop plist with given period/offset. hour="" triggers the
# StartCalendarInterval path (not StartInterval=86400 for daily services).
_write_loop_plist() {
  local plist="$1" label="$2" project="$3" period="$4" offset="$5" runner="$6"
  _write_launchd_plist "$plist" "$label" "$project" "$period" "$offset" "" "$runner"
}

# ─── period=60: backward compat (single dict) ────────────────────────────────

@test "_write_launchd_plist: period=60 generates single StartCalendarInterval dict" {
  local plist="${_LAUNCHD_DIR}/loop-60.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "60" "18" "/tmp/runner.sh"
  [ -f "$plist" ]

  # Must contain StartCalendarInterval with a single <dict>
  grep -q 'StartCalendarInterval' "$plist"
  grep -q '<integer>18</integer>' "$plist"

  # Must NOT contain StartCalendarInterval <array> (period=60 uses single dict)
  # Check that StartCalendarInterval is followed by <dict>, not <array>
  grep -A1 'StartCalendarInterval' "$plist" | grep -q '<dict>'
}

# ─── period=30: array with 2 entries ─────────────────────────────────────────

@test "_write_launchd_plist: period=30 offset=0 generates 2-entry array" {
  local plist="${_LAUNCHD_DIR}/loop-30-0.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "30" "0" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q 'StartCalendarInterval' "$plist"
  grep -q '<array>' "$plist"
  # Minute entries: 0, 30
  grep -q '<integer>0</integer>' "$plist"
  grep -q '<integer>30</integer>' "$plist"
}

@test "_write_launchd_plist: period=30 offset=7 generates 2-entry array" {
  local plist="${_LAUNCHD_DIR}/loop-30-7.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "30" "7" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q '<array>' "$plist"
  grep -q '<integer>7</integer>' "$plist"
  grep -q '<integer>37</integer>' "$plist"
}

# ─── period=15: array with 4 entries ─────────────────────────────────────────

@test "_write_launchd_plist: period=15 offset=7 generates 4-entry array" {
  local plist="${_LAUNCHD_DIR}/loop-15-7.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "15" "7" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q '<array>' "$plist"
  grep -q '<integer>7</integer>' "$plist"
  grep -q '<integer>22</integer>' "$plist"
  grep -q '<integer>37</integer>' "$plist"
  grep -q '<integer>52</integer>' "$plist"
}

@test "_write_launchd_plist: period=15 offset=0 generates 4-entry array" {
  local plist="${_LAUNCHD_DIR}/loop-15-0.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "15" "0" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q '<array>' "$plist"
  grep -q '<integer>0</integer>' "$plist"
  grep -q '<integer>15</integer>' "$plist"
  grep -q '<integer>30</integer>' "$plist"
  grep -q '<integer>45</integer>' "$plist"
}

# ─── period=20: array with 3 entries ─────────────────────────────────────────

@test "_write_launchd_plist: period=20 offset=5 generates 3-entry array" {
  local plist="${_LAUNCHD_DIR}/loop-20-5.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "20" "5" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q '<array>' "$plist"
  grep -q '<integer>5</integer>' "$plist"
  grep -q '<integer>25</integer>' "$plist"
  grep -q '<integer>45</integer>' "$plist"
}

# ─── period=5: array with 12 entries ─────────────────────────────────────────

@test "_write_launchd_plist: period=5 offset=3 generates 12-entry array" {
  local plist="${_LAUNCHD_DIR}/loop-5-3.plist"
  _write_loop_plist "$plist" "com.roll.loop.test" "$PWD" "5" "3" "/tmp/runner.sh"
  [ -f "$plist" ]

  grep -q '<array>' "$plist"
  # All 12 entries: 3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58
  for m in 3 8 13 18 23 28 33 38 43 48 53 58; do
    grep -q "<integer>${m}</integer>" "$plist"
  done
}

# ─── Daily services still generate StartInterval=86400 ──────────────────────

@test "_write_launchd_plist: daily service (hour present) generates StartInterval, not calendar" {
  local plist="${_LAUNCHD_DIR}/dream-daily.plist"
  _write_launchd_plist "$plist" "com.roll.dream.test" "$PWD" "60" "18" "3" "/tmp/runner.sh"
  [ -f "$plist" ]

  # Daily services with hour present use StartInterval=86400 (FIX-105)
  grep -q 'StartInterval' "$plist"
  grep -q '<integer>86400</integer>' "$plist"

  # Should NOT have StartCalendarInterval
  ! grep -q 'StartCalendarInterval' "$plist"
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

# ─── count check: ensures exactly 60/period dict entries ────────────────────

@test "_write_launchd_plist: array has exactly 60/period entries" {
  for period in 30 20 15 12 10 6 5; do
    local plist="${_LAUNCHD_DIR}/loop-count-${period}.plist"
    _write_loop_plist "$plist" "com.roll.loop.cnt" "$PWD" "$period" "0" "/tmp/runner.sh"
    # Count the number of <dict> entries inside StartCalendarInterval <array>
    # Extract lines between StartCalendarInterval and the next top-level <key>
    local count
    count=$(sed -n '/StartCalendarInterval/,/<key>WorkingDirectory</p' "$plist" | grep -c '<dict>' || true)
    local expected=$((60 / period))
    [ "$count" -eq "$expected" ]
    rm -f "$plist"
  done
}
