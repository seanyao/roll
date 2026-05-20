#!/usr/bin/env bats
# Unit tests for: roll peer v2 redesign (US-VIEW-009)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  rm -rf "$TEST_DIR"
}

# FIX-076: fixture data is gated on the ROLL_RENDER_FIXTURE env var; user-facing
# CLI no longer exposes --demo. Tests opt into fixture rendering explicitly.
_run_fixture() {
  ROLL_RENDER_FIXTURE=1 run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" "$@"
}

@test "peer v2: Python renderer runs standalone with ROLL_RENDER_FIXTURE=1" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"PEER"* ]]
  [[ "$output" == *"cross-agent review"* ]]
}

@test "peer v2: fixture shows trigger tag in eyebrow" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"complexity=large"* ]]
}

@test "peer v2: fixture subject row carries story id + PR + diff stat" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-AUTH-014"* ]]
  [[ "$output" == *"#412"* ]]
  [[ "$output" == *"+184"* ]]
}

@test "peer v2: fixture shows proposer/reviewer pair" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"proposer"* ]]
  [[ "$output" == *"reviewer"* ]]
  [[ "$output" == *"claude"* ]]
  [[ "$output" == *"codex"* ]]
}

@test "peer v2: fixture shows ROUND headers" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"ROUND 1"* ]]
  [[ "$output" == *"ROUND 2"* ]]
}

@test "peer v2: fixture shows all four weight chips" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"concern"* ]]
  [[ "$output" == *"nit"* ]]
  [[ "$output" == *"ack"* ]]
  [[ "$output" == *"block"* ]]
}

@test "peer v2: fixture ends with VERDICT line" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT"* ]]
  [[ "$output" == *"approved"* ]]
}

@test "peer v2: fixture shows artifact path + NEXT section" {
  cd "$TEST_DIR"
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"artifact"* ]]
  [[ "$output" == *".peer-state/logs/"* ]]
  [[ "$output" == *"NEXT"* ]]
}

@test "peer v2: --no-color suppresses ANSI escapes" {
  cd "$TEST_DIR"
  _run_fixture --no-color
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033'* ]]
}

# FIX-076: `roll peer --demo` is rejected; user-facing CLI must not surface demo.
@test "peer v2: roll peer --demo is rejected (FIX-076)" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" peer --demo
  [ "$status" -ne 0 ]
  [[ "$output" == *"--demo"* ]]
}

# FIX-076: `python3 lib/roll-peer.py` without the opt-in env var must refuse to
# render — prevents a stray invocation from looking like live output.
@test "peer v2: standalone python3 without ROLL_RENDER_FIXTURE is rejected" {
  cd "$TEST_DIR"
  run env -u ROLL_RENDER_FIXTURE python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py"
  [ "$status" -eq 2 ]
  [[ "$output" == *"ROLL_RENDER_FIXTURE"* ]]
}
