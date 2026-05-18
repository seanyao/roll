#!/usr/bin/env bats
# Unit tests for: roll init v2 redesign (US-VIEW-008)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "init v2: Python renderer runs standalone with --demo" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"INIT"* ]]
  [[ "$output" == *"✓"* ]]
}

@test "init v2: demo shows numbered steps" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"1."* ]]
  [[ "$output" == *"6."* ]]
}

@test "init v2: demo shows file-operation markers + and ~" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"+"* ]]
  [[ "$output" == *"~"* ]]
}

@test "init v2: demo shows 'Project ready' footer" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"Project ready"* ]]
}

@test "init v2: demo shows NEXT section with three follow-up steps" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"NEXT"* ]]
  # Three numbered next-steps OR bullet markers
  echo "$output" | grep -cE "^\s+[1-3]\." | grep -q "^[3-9]" || \
    echo "$output" | grep -qE "(BACKLOG|backlog).*(loop|cycle)"
}

@test "init v2: --no-color suppresses ANSI escapes" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-init.py" --demo --no-color
  [ "$status" -eq 0 ]
  # No ESC sequences
  [[ "$output" != *$'\033'* ]]
}

@test "init v2: ROLL_UI=v2 with --demo routes through Python renderer and exits cleanly" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" init --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"INIT"* ]]
}
