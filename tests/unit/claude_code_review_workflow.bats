#!/usr/bin/env bats
# US-AUTO-035: claude-code-review.yml gains approve/request-changes capability.

WF="${BATS_TEST_DIRNAME}/../../.github/workflows/claude-code-review.yml"

@test "claude-code-review.yml: pull-requests permission is write (not read)" {
  grep -qE '^[[:space:]]+pull-requests:[[:space:]]+write' "$WF"
}
