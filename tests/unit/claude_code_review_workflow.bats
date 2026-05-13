#!/usr/bin/env bats
# US-AUTO-035: claude-code-review.yml gains approve/request-changes capability.

WF="${BATS_TEST_DIRNAME}/../../.github/workflows/claude-code-review.yml"

@test "claude-code-review.yml: pull-requests permission is write (not read)" {
  grep -qE '^[[:space:]]+pull-requests:[[:space:]]+write' "$WF"
}

@test "claude-code-review.yml: escape hatch checks PR body for [skip-ai-review]" {
  grep -qF '[skip-ai-review]' "$WF"
}

@test "claude-code-review.yml: escape hatch checks commit messages for SKIP_AI_REVIEW" {
  grep -qF 'SKIP_AI_REVIEW' "$WF"
}

@test "claude-code-review.yml: skip path runs gh pr review --approve" {
  # When escape hatch fires, the workflow auto-approves so merge is not blocked.
  grep -qE 'gh pr review .* --approve' "$WF"
}
