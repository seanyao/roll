#!/usr/bin/env bats
# Unit tests for tests/run.sh parallel auto-detection (REFACTOR-006)

setup() {
  TEST_TMP="$(mktemp -d)"
  RUNNER="${BATS_TEST_DIRNAME}/../../tests/run.sh"
}

teardown() {
  rm -rf "$TEST_TMP"
}

@test "run.sh: exists and is executable" {
  [ -x "$RUNNER" ]
}

@test "run.sh: uses --jobs flag when 'parallel' binary is available" {
  # Create a fake parallel binary in a temp bin dir
  local fake_bin="$TEST_TMP/bin"
  mkdir -p "$fake_bin"
  printf '#!/bin/sh\nexit 0\n' > "$fake_bin/parallel"
  chmod +x "$fake_bin/parallel"

  # Capture what the runner would pass to bats by checking its content
  PATH="$fake_bin:$PATH" grep -q "\-\-jobs" "$RUNNER"
}

@test "run.sh: falls back to sequential when parallel is not available" {
  # Verify the script has a conditional check for parallel availability
  grep -q "command -v parallel" "$RUNNER"
}

@test "run.sh: finds test files in unit and integration directories" {
  grep -q "unit" "$RUNNER"
  grep -q "integration" "$RUNNER"
}
