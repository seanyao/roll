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

@test "peer v2: Python renderer runs standalone with --demo" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"PEER"* ]]
  [[ "$output" == *"cross-agent review"* ]]
}

@test "peer v2: demo shows trigger tag in eyebrow" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"complexity=large"* ]]
}

@test "peer v2: demo subject row carries story id + PR + diff stat" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-AUTH-014"* ]]
  [[ "$output" == *"#412"* ]]
  [[ "$output" == *"+184"* ]]
}

@test "peer v2: demo shows proposer/reviewer pair" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"proposer"* ]]
  [[ "$output" == *"reviewer"* ]]
  [[ "$output" == *"claude"* ]]
  [[ "$output" == *"codex"* ]]
}

@test "peer v2: demo shows ROUND headers" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"ROUND 1"* ]]
  [[ "$output" == *"ROUND 2"* ]]
}

@test "peer v2: demo shows all four weight chips" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"concern"* ]]
  [[ "$output" == *"nit"* ]]
  [[ "$output" == *"ack"* ]]
  [[ "$output" == *"block"* ]]
}

@test "peer v2: demo ends with VERDICT line" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT"* ]]
  [[ "$output" == *"approved"* ]]
}

@test "peer v2: demo shows artifact path + NEXT section" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"artifact"* ]]
  [[ "$output" == *".peer-state/logs/"* ]]
  [[ "$output" == *"NEXT"* ]]
}

@test "peer v2: --no-color suppresses ANSI escapes" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-peer.py" --demo --no-color
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033'* ]]
}

@test "peer v2: ROLL_UI=v2 with --demo routes through Python renderer and exits cleanly" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" peer --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"PEER"* ]]
  [[ "$output" == *"VERDICT"* ]]
}
