#!/usr/bin/env bats
# Unit tests for: roll setup v2 real-data UI (FIX-073)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
ROLL_DIR="${ROLL_BIN%/bin/roll}"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ─── roll-setup.py renderer: stdin JSON only ─────────────────────────────────

@test "setup v2: renderer renders headers, steps, and footer from stdin JSON" {
  cd "$TEST_DIR"
  payload='{"header_label":"SETUP","subtitle":"初始化","steps":[{"num":1,"label":"Detect platform & shell","status":"ok"},{"num":2,"label":"Install skills","status":"ok"}],"footer":{"status":"ok","label":"Setup complete","hint":"run roll init"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-setup.py\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"SETUP"* ]]
  [[ "$output" == *"Detect platform & shell"* ]]
  [[ "$output" == *"Setup complete"* ]]
  [[ "$output" == *"run roll init"* ]]
}

@test "setup v2: renderer marks failed step with ✗ and incomplete footer" {
  cd "$TEST_DIR"
  payload='{"header_label":"SETUP","steps":[{"num":1,"label":"x","status":"fail","error":"network"}],"footer":{"status":"fail","label":"Setup incomplete"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-setup.py\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"✗"* ]]
  [[ "$output" == *"network"* ]]
  [[ "$output" == *"Setup incomplete"* ]]
}

@test "setup v2: renderer marks skipped step with ↷" {
  cd "$TEST_DIR"
  payload='{"header_label":"SETUP","steps":[{"num":1,"label":"x","status":"skip","note":"already present"}],"footer":{"status":"ok","label":"Setup complete"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-setup.py\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"↷"* ]]
  [[ "$output" == *"already present"* ]]
}

# FIX-075: forced overwrite marker distinguishes -f re-install from a no-op repeat.
@test "setup v2: renderer marks forced step with ~" {
  cd "$TEST_DIR"
  payload='{"header_label":"SETUP","steps":[{"num":1,"label":"x","status":"forced","note":"overwrote existing"}],"footer":{"status":"ok","label":"Setup re-installed (forced)"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-setup.py\""
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '~'
  [[ "$output" == *"overwrote existing"* ]]
  [[ "$output" == *"forced"* ]]
}

@test "setup v2: renderer exits non-zero on empty stdin (no demo fallback)" {
  cd "$TEST_DIR"
  run bash -c ": | python3 \"$ROLL_DIR/lib/roll-setup.py\""
  [ "$status" -ne 0 ]
}

@test "setup v2: --no-color suppresses ANSI escapes" {
  cd "$TEST_DIR"
  payload='{"header_label":"SETUP","steps":[{"num":1,"label":"x","status":"ok"}],"footer":{"status":"ok","label":"ok"}}'
  run bash -c "echo '$payload' | python3 \"$ROLL_DIR/lib/roll-setup.py\" --no-color"
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033'* ]]
}

# ─── roll setup (bash entry) ─────────────────────────────────────────────────

@test "setup: unknown flag is rejected" {
  cd "$TEST_DIR"
  ROLL_PKG_DIR="$ROLL_DIR" run bash "$ROLL_BIN" setup --bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"Unknown"* ]] || [[ "$output" == *"未知参数"* ]]
}
