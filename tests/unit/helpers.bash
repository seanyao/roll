#!/usr/bin/env bash
# Shared helpers for unit tests.
# Load with: load helpers  (from a .bats file in tests/unit/)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

# Source bin/roll, create isolated temp dir, suppress colour output.
unit_setup() {
  source "$ROLL_BIN"
  TEST_TMP="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
}

# Remove temp dir created by unit_setup.
unit_teardown() {
  rm -rf "${TEST_TMP:-}"
}

# Like unit_setup but also cds into TEST_TMP (for tests that use relative paths).
unit_setup_cd() {
  source "$ROLL_BIN"
  _UNIT_ORIG_DIR="$PWD"
  TEST_TMP="$(mktemp -d)"
  cd "$TEST_TMP"
  export NO_COLOR=1
  export TERM=dumb
}

# Restore original directory and remove temp dir created by unit_setup_cd.
unit_teardown_cd() {
  cd "$_UNIT_ORIG_DIR"
  rm -rf "${TEST_TMP:-}"
}
