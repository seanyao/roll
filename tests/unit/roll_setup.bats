#!/usr/bin/env bats
# Unit tests for: roll setup v2 redesign (US-VIEW-007)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "setup v2: ROLL_UI=v2 routes to Python implementation (--demo)" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" setup --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"SETUP"* ]]
}

@test "setup v2: ROLL_UI=v1 uses legacy bash implementation" {
  # v1 should print the old-style [roll] info messages
  skip "v1 setup modifies machine state — tested via existing tests"
}

@test "setup v2: demo shows numbered steps" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" setup --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"1."* ]] || [[ "$output" == *"  1 "* ]] || [[ "$output" == *"Step 1"* ]]
}

@test "setup v2: demo shows at least 3 steps" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" setup --demo
  [ "$status" -eq 0 ]
  # Should have multiple step entries
  [[ "$output" == *"3."* ]] || echo "$output" | grep -qE "^\s+[3-9]\."
}

@test "setup v2: demo shows checkmarks for completed steps" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" setup --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"✓"* ]]
}

@test "setup v2: demo shows 'Setup complete' in footer" {
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" setup --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"Setup complete"* ]] || [[ "$output" == *"complete"* ]]
}

@test "setup v2: Python renderer runs standalone with --demo" {
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-setup.py" --demo
  [ "$status" -eq 0 ]
  [[ "$output" == *"SETUP"* ]]
  [[ "$output" == *"✓"* ]]
}
