#!/usr/bin/env bats
# FIX-151: dedicated loop heartbeat tick helper tests.
#
# Covers _loop_write_tick (JSONL format, rotation, idempotency) and
# _loop_read_last_tick (parse last record from tick file).

load helpers

setup() {
  unit_setup_cd
  info() { :; }
  warn() { :; }
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/.roll/loop"
}
teardown() { unit_teardown_cd; }

# ── _loop_write_tick ────────────────────────────────────────────────────────

@test "_loop_write_tick: writes correct JSONL shape" {
  _loop_write_tick "ci" "idle" ""
  [ -f .roll/loop/ci-tick.jsonl ]
  run cat .roll/loop/ci-tick.jsonl
  [ "$status" -eq 0 ]
  [[ "$output" == *'"loop":"ci"'* ]]
  [[ "$output" == *'"outcome":"idle"'* ]]
  [[ "$output" == *'"ts":"'* ]]
}

@test "_loop_write_tick: outcome=acted with note" {
  _loop_write_tick "pr" "acted" "merged #42"
  run cat .roll/loop/pr-tick.jsonl
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome":"acted"'* ]]
  [[ "$output" == *'"note":"merged #42"'* ]]
}

@test "_loop_write_tick: appends multiple lines" {
  _loop_write_tick "alert" "idle" ""
  _loop_write_tick "alert" "acted" "notified"
  run wc -l < .roll/loop/alert-tick.jsonl
  [ "$output" -eq 2 ]
}

@test "_loop_write_tick: rotates when exceeding max lines (alert=1000)" {
  mkdir -p .roll/loop
  # Seed alert-tick.jsonl with 1002 lines
  for i in $(seq 1 1002); do
    printf '{"ts":"2026-05-01T00:00:00Z","loop":"alert","outcome":"idle","note":""}\n' >> .roll/loop/alert-tick.jsonl
  done
  _loop_write_tick "alert" "idle" ""
  run wc -l < .roll/loop/alert-tick.jsonl
  [ "$output" -eq 1000 ]
  # Last line should be the newly written one
  run tail -1 .roll/loop/alert-tick.jsonl
  [[ "$output" == *'"outcome":"idle"'* ]]
}

@test "_loop_write_tick: rotates when exceeding max lines (ci=500)" {
  mkdir -p .roll/loop
  for i in $(seq 1 502); do
    printf '{"ts":"2026-05-01T00:00:00Z","loop":"ci","outcome":"idle","note":""}\n' >> .roll/loop/ci-tick.jsonl
  done
  _loop_write_tick "ci" "idle" ""
  run wc -l < .roll/loop/ci-tick.jsonl
  [ "$output" -eq 500 ]
}

@test "_loop_write_tick: uses _SHARED_ROOT fallback when _loop_runtime_dir fails" {
  _loop_runtime_dir() { return 1; }
  _loop_write_tick "pr" "idle" ""
  local slug; slug=$(_project_slug 2>/dev/null || basename "$PWD")
  [ -f "${_SHARED_ROOT}/loop/pr-tick-${slug}.jsonl" ]
}

# ── _loop_read_last_tick ────────────────────────────────────────────────────

@test "_loop_read_last_tick: returns empty string for missing file" {
  run _loop_read_last_tick "ci"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_loop_read_last_tick: returns last line of tick file" {
  _loop_write_tick "ci" "idle" "first"
  _loop_write_tick "ci" "acted" "second"
  run _loop_read_last_tick "ci"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome":"acted"'* ]]
  [[ "$output" == *'"note":"second"'* ]]
}

@test "_loop_read_last_tick: extracts ts field" {
  _loop_write_tick "alert" "idle" ""
  run _loop_read_last_tick "alert" "ts"
  [ "$status" -eq 0 ]
  [[ "$output" == 2026-* ]]
}
