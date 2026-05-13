#!/usr/bin/env bash
set -euo pipefail

BATS="$(dirname "$0")/helpers/bats-core/bin/bats"

# REFACTOR-008 Phase 1: clear error when bats-core submodule not initialized.
if [ ! -x "$BATS" ]; then
  echo "error: bats binary not found at $BATS" >&2
  echo "hint: run 'git submodule update --init --recursive' to fetch bats-core" >&2
  exit 1
fi

# REFACTOR-009 Phase 1B: optional args override the default scan paths,
# so CI can run `bash tests/run.sh tests/unit` and `tests/integration` in parallel jobs.
if [ "$#" -gt 0 ]; then
  SCAN_PATHS=("$@")
else
  SCAN_PATHS=("$(dirname "$0")/unit" "$(dirname "$0")/integration")
fi

FILES=$(find "${SCAN_PATHS[@]}" -name '*.bats' | sort)

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

# Write proof-of-pass for pre-commit hook (US-INFRA-006).
# Records timestamp + working tree hash so the hook can verify tests ran on
# exactly the code being committed, not a prior or modified version.
_REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$_REPO_ROOT" ]; then
  mkdir -p "$_REPO_ROOT/.roll"
  _TREE="$(git -C "$_REPO_ROOT" write-tree 2>/dev/null || true)"
  if [ -n "$_TREE" ]; then
    printf '{"ts":%s,"tree":"%s"}\n' "$(date +%s)" "$_TREE" \
      > "$_REPO_ROOT/.roll/last-test-pass"
  fi
fi
