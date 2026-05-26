#!/usr/bin/env bats
# US-LOOP-023: load_events reads the rotated history (events-*.ndjson.1..4),
# not just the head file. Once events-<slug>.ndjson exceeds 10MB and rotates,
# the dashboard must still show cycles whose events landed in the rotated
# files — otherwise "永久留存" is fiction.

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

setup() {
  TEST_TMP="$(mktemp -d)"
  mkdir -p "${TEST_TMP}/loop"
  export ROLL_SHARED_ROOT="${TEST_TMP}"
}

teardown() {
  rm -rf "${TEST_TMP:-}"
}

# Write one NDJSON event to <path>. Args: file ts stage label
write_event() {
  local file="$1" ts="$2" stage="$3" label="$4"
  printf '{"ts":"%s","stage":"%s","label":"%s","detail":"","outcome":"ok"}\n' \
    "$ts" "$stage" "$label" >> "$file"
}

# Drive load_events via importlib; print count + first/last labels for easy assertions.
load_count() {
  local slug="$1" days="$2"
  python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
evs = m.load_events('${slug}', ${days})
print(len(evs))
for e in evs:
    print(e.get('label',''), e.get('ts',''), sep='|')
"
}

@test "US-LOOP-023: head-only file still works (regression)" {
  local f="${TEST_TMP}/loop/events-myslug.ndjson"
  local now_iso="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  write_event "$f" "$now_iso" "cycle_start" "20260101-000000-1"
  write_event "$f" "$now_iso" "cycle_end"   "20260101-000000-1"
  run load_count "myslug" 30
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "2" ]
}

@test "US-LOOP-023: head + .1 both read, events merged" {
  local head="${TEST_TMP}/loop/events-myslug.ndjson"
  local rot1="${TEST_TMP}/loop/events-myslug.ndjson.1"
  local now_iso="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  write_event "$rot1" "$now_iso" "cycle_start" "OLD-cycle"
  write_event "$head" "$now_iso" "cycle_start" "NEW-cycle"
  run load_count "myslug" 30
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "2" ]
  [[ "$output" == *"OLD-cycle"* ]]
  [[ "$output" == *"NEW-cycle"* ]]
}

@test "US-LOOP-023: head missing, .1 alone still loads" {
  local rot1="${TEST_TMP}/loop/events-myslug.ndjson.1"
  local now_iso="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  write_event "$rot1" "$now_iso" "cycle_start" "ORPHAN-cycle"
  run load_count "myslug" 30
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1" ]
  [[ "$output" == *"ORPHAN-cycle"* ]]
}

@test "US-LOOP-023: identical lines across files dedup to one" {
  local head="${TEST_TMP}/loop/events-myslug.ndjson"
  local rot1="${TEST_TMP}/loop/events-myslug.ndjson.1"
  local now_iso="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  write_event "$rot1" "$now_iso" "cycle_start" "SAME-cycle"
  write_event "$head" "$now_iso" "cycle_start" "SAME-cycle"
  run load_count "myslug" 30
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1" ]
}

@test "US-LOOP-023: events outside days cutoff are filtered" {
  local head="${TEST_TMP}/loop/events-myslug.ndjson"
  local rot1="${TEST_TMP}/loop/events-myslug.ndjson.1"
  local recent_iso="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  # Ancient event in rotated file (year 2020) — must be filtered when days=3
  write_event "$rot1" "2020-01-01T00:00:00Z" "cycle_start" "ANCIENT"
  write_event "$head" "$recent_iso" "cycle_start" "RECENT"
  run load_count "myslug" 3
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1" ]
  [[ "$output" == *"RECENT"* ]]
  [[ "$output" != *"ANCIENT"* ]]
}

@test "US-LOOP-023: ROLL_DEBUG_LOAD emits summary to stderr" {
  local head="${TEST_TMP}/loop/events-myslug.ndjson"
  local rot1="${TEST_TMP}/loop/events-myslug.ndjson.1"
  local now_iso="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  write_event "$head" "$now_iso" "cycle_start" "A"
  write_event "$rot1" "$now_iso" "cycle_start" "B"
  ROLL_DEBUG_LOAD=1 run bash -c "python3 -c \"
import sys, importlib.util
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.load_events('myslug', 30)
\" 2>&1 >/dev/null"
  [[ "$output" == *"loaded"* ]]
  [[ "$output" == *"2 files"* ]] || [[ "$output" == *"from 2"* ]]
}

@test "US-LOOP-023: events sorted ascending by ts across files" {
  local head="${TEST_TMP}/loop/events-myslug.ndjson"
  local rot1="${TEST_TMP}/loop/events-myslug.ndjson.1"
  local now_dt="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).isoformat())')"
  # Rotated file contains an earlier event; head contains a later one.
  write_event "$rot1" "2026-01-01T00:00:00Z" "cycle_start" "EARLY"
  write_event "$head" "2026-06-01T00:00:00Z" "cycle_start" "LATE"
  run load_count "myslug" 365
  [ "$status" -eq 0 ]
  # First data line is the count; lines[1] should be the EARLY entry.
  [[ "${lines[1]}" == *"EARLY"* ]]
  [[ "${lines[2]}" == *"LATE"* ]]
}

@test "US-LOOP-023: only .1..4 read, not .5 or other backups" {
  local head="${TEST_TMP}/loop/events-myslug.ndjson"
  local rot5="${TEST_TMP}/loop/events-myslug.ndjson.5"
  local bakx="${TEST_TMP}/loop/events-myslug.ndjson.bak"
  local now_iso="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  write_event "$head" "$now_iso" "cycle_start" "HEAD"
  write_event "$rot5" "$now_iso" "cycle_start" "FIVE"
  write_event "$bakx" "$now_iso" "cycle_start" "BAKX"
  run load_count "myslug" 30
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1" ]
  [[ "$output" == *"HEAD"* ]]
}
