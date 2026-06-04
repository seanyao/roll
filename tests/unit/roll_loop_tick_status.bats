#!/usr/bin/env bats
# FIX-151: dedicated loop tick display in legacy status view.

load helpers

setup() {
  unit_setup_cd
  info() { :; }
  warn() { :; }
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/.roll/loop"
}
teardown() { unit_teardown_cd; }

# FIX-194: ci/alert services were retired by the #440 PR-loop architect
# rewrite — the legacy status renders loop/dream/brief/pr only; pr is the
# sole dedicated loop with a tick heartbeat.
@test "_legacy_loop_status: shows tick age for pr when tick exists" {
  # _legacy_loop_status renders service lines only on macOS (launchd services)
  [[ "$(uname)" == "Darwin" ]] || skip "service lines only rendered on macOS"
  mkdir -p .roll/loop
  # Seed tick file with a recent timestamp
  printf '{"ts":"%s","loop":"pr","outcome":"idle","note":""}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > .roll/loop/pr-tick.jsonl

  run _legacy_loop_status
  [ "$status" -eq 0 ]
  # pr should appear with a tick age indicator ("tick" or time)
  [[ "$output" == *"pr"*"tick"* ]] || [[ "$output" == *"pr"*"s"* ]]
}

@test "_legacy_loop_status: handles missing tick files gracefully" {
  # _legacy_loop_status renders service lines only on macOS (launchd services)
  [[ "$(uname)" == "Darwin" ]] || skip "service lines only rendered on macOS"
  run _legacy_loop_status
  [ "$status" -eq 0 ]
  # pr service still shown even without ticks
  [[ "$output" == *"pr"* ]]
}

# ── Python v2 status tick display ───────────────────────────────────────────

run_py() {
  python3 -c "
import sys, os
os.environ['ROLL_UI'] = 'v2'
os.environ['NO_COLOR'] = '1'
sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
import importlib.util
spec = importlib.util.spec_from_file_location('status', '${BATS_TEST_DIRNAME}/../../lib/roll-loop-status.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
$1
"
}

@test "roll-loop-status.py: shows tick age for pr/ci/alert" {
  mkdir -p .roll/loop
  local ts; ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"ts":"%s","loop":"pr","outcome":"idle","note":""}\n' "$ts" > .roll/loop/pr-tick.jsonl
  printf '{"ts":"%s","loop":"ci","outcome":"idle","note":""}\n' "$ts" > .roll/loop/ci-tick.jsonl
  printf '{"ts":"%s","loop":"alert","outcome":"idle","note":""}\n' "$ts" > .roll/loop/alert-tick.jsonl

  run run_py '
print(mod._tick_age_line("pr") or "NONE")
print(mod._tick_age_line("ci") or "NONE")
print(mod._tick_age_line("alert") or "NONE")
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"pr: tick"* ]]
  [[ "$output" == *"ci: tick"* ]]
  [[ "$output" == *"alert: tick"* ]]
}

@test "roll-loop-status.py: returns None when tick file missing" {
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/.roll/loop"
  # Ensure the temp dir exists but has no tick files
  mkdir -p "${TEST_TMP}/.roll/loop"
  rm -f "${TEST_TMP}/.roll/loop/pr-tick.jsonl"
  run run_py 'print(mod._tick_age_line("pr"))'
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}
