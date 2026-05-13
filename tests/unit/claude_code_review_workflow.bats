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

@test "claude-code-review.yml: prompt instructs --request-changes for issues" {
  grep -qE 'gh pr review.*--request-changes' "$WF"
}

@test "claude-code-review.yml: prompt has UNCERTAIN path with _LOOP_ALERT marker" {
  grep -qF 'UNCERTAIN' "$WF"
  grep -qF '_LOOP_ALERT' "$WF"
}

@test "claude-code-review.yml: failure mode forbids approve/request-changes" {
  # Tool-call failures must NOT silently approve or silently request-changes.
  # The reviewer should comment-only and let the CI gate decide.
  grep -qE 'do NOT.*approve' "$WF"
}
