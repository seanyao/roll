#!/usr/bin/env bash
set -euo pipefail

BATS="$(dirname "$0")/helpers/bats-core/bin/bats"

# REFACTOR-008 Phase 1: clear error when bats-core submodule not initialized.
if [ ! -x "$BATS" ]; then
  echo "error: bats binary not found at $BATS" >&2
  echo "hint: run 'git submodule update --init --recursive' to fetch bats-core" >&2
  exit 1
fi

FILES=$(find "$(dirname "$0")/unit" "$(dirname "$0")/integration" -name '*.bats' | sort)

# REFACTOR-008 Phase 1: detect CPU count dynamically instead of hardcoded 4.
JOBS="${ROLL_TEST_JOBS:-}"
if [ -z "$JOBS" ]; then
  JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
fi

if command -v parallel >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  echo "$FILES" | xargs "$BATS" --jobs "$JOBS" --no-parallelize-within-files
else
  # shellcheck disable=SC2086
  echo "$FILES" | xargs "$BATS"
fi
