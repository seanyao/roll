#!/usr/bin/env bash
set -euo pipefail

BATS="$(dirname "$0")/helpers/bats-core/bin/bats"
FILES=$(find "$(dirname "$0")/unit" "$(dirname "$0")/integration" -name '*.bats' | sort)

if command -v parallel >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  echo "$FILES" | xargs "$BATS" --jobs 4 --no-parallelize-within-files
else
  # shellcheck disable=SC2086
  echo "$FILES" | xargs "$BATS"
fi
