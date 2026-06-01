#!/usr/bin/env bats
load helpers
setup()    { unit_setup_cd; unset ROLL_MAIN_SLUG; }
teardown() { unit_teardown_cd; }

@test "_loop_event: writes tab-separated line to stdout" {
  _SHARED_ROOT="$TEST_TMP"
  run _loop_event "tcr" "a3f1b2" "add token validation" "ok"
  [[ "$output" == *$'\t'"tcr"$'\t'* ]]
}

@test "_loop_event: creates NDJSON file" {
  _SHARED_ROOT="$TEST_TMP"
  _loop_event "tcr" "abc123" "test commit" "ok"
  local slug; slug=$(_project_slug 2>/dev/null || basename "$PWD")
  [ -f "$TEST_TMP/loop/events-${slug}.ndjson" ]
}

@test "_loop_event: NDJSON line is valid JSON" {
  _SHARED_ROOT="$TEST_TMP"
  _loop_event "tcr" "abc123" "test commit" "ok"
  local slug; slug=$(_project_slug 2>/dev/null || basename "$PWD")
  local f="$TEST_TMP/loop/events-${slug}.ndjson"
  python3 -c "import json,sys; [json.loads(l) for l in open('$f') if l.strip()]"
}

@test "_loop_event: JSON has required fields" {
  _SHARED_ROOT="$TEST_TMP"
  _loop_event "ci" "green" "43s · 26 tests" "ok"
  local slug; slug=$(_project_slug 2>/dev/null || basename "$PWD")
  local f="$TEST_TMP/loop/events-${slug}.ndjson"
  python3 -c "
import json
e = json.loads(open('$f').read().strip())
assert 'ts' in e and 'stage' in e and 'label' in e
"
}

@test "_loop_event: FIX-067 concurrent writers — all lines survive without a lock file" {
  _SHARED_ROOT="$TEST_TMP"
  local slug; slug=$(_project_slug 2>/dev/null || basename "$PWD")
  local f="$TEST_TMP/loop/events-${slug}.ndjson"

  # Fork 20 writers; each appends one event. Atomic append must keep all 20
  # whole lines (no interleaving, no missing rows) without any lockfile.
  local pids=()
  for i in $(seq 1 20); do
    ( _loop_event "tcr" "id-$i" "concurrent write $i" "ok" >/dev/null ) &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p"; done

  [ -f "$f" ]
  local count; count=$(wc -l < "$f")
  [ "$count" -eq 20 ]
  # No bare ".lock" sidecar should be created any more.
  [ ! -f "${f}.lock" ]
  # Each line is valid JSON
  python3 -c "import json; [json.loads(l) for l in open('$f') if l.strip()]"
}

@test "_loop_event: FIX-067 no lockfile created on plain single write" {
  _SHARED_ROOT="$TEST_TMP"
  local slug; slug=$(_project_slug 2>/dev/null || basename "$PWD")
  local f="$TEST_TMP/loop/events-${slug}.ndjson"
  _loop_event "ci" "green" "single write" "ok"
  [ -f "$f" ]
  [ ! -f "${f}.lock" ]
}

@test "_loop_event: FIX-157 creates file when missing in worktree with ROLL_MAIN_SLUG" {
  # Simulate main project + worktree layout: _loop_event must write to main
  # project's .roll/loop/events.ndjson, not a local worktree path.
  local main_proj="${TEST_TMP}/main-project"
  mkdir -p "${main_proj}/.roll/loop"
  export ROLL_MAIN_SLUG="test-fix157"
  # Override _loop_runtime_dir to return main project path
  _loop_runtime_dir() { echo "${main_proj}/.roll/loop"; }

  local f="${main_proj}/.roll/loop/events.ndjson"
  [ ! -f "$f" ]

  _loop_event "cycle_start" "20260601-220000-00000" "" ""

  [ -f "$f" ]
  run wc -l < "$f"
  [ "$output" -eq 1 ]
  python3 -c "import json; json.loads(open('$f').read().strip())"
}

@test "_loop_event_rotate: rotates file when over 10MB" {
  _SHARED_ROOT="$TEST_TMP"
  local slug; slug=$(_project_slug 2>/dev/null || echo "testproj")
  local f="$TEST_TMP/loop/events-${slug}.ndjson"
  mkdir -p "$(dirname "$f")"
  # create 11MB file
  dd if=/dev/zero bs=1024 count=11264 2>/dev/null > "$f"
  _loop_event_rotate "$f"
  [ -f "${f}.1" ]
  [ ! -s "$f" ] || [ "$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")" -lt 10485760 ]
}
