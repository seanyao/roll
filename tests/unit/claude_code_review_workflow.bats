#!/usr/bin/env bats
# claude-code-review.yml: manual-trigger only, not auto on PRs.

WF="${BATS_TEST_DIRNAME}/../../.github/workflows/claude-code-review.yml"

@test "claude-code-review.yml: triggered by workflow_dispatch only (not pull_request)" {
  grep -qF 'workflow_dispatch' "$WF"
  ! grep -qF 'pull_request' "$WF"
}

@test "claude-code-review.yml: requires pr_number input" {
  grep -qF 'pr_number' "$WF"
}

@test "claude-code-review.yml: pull-requests permission is write" {
  grep -qE '^[[:space:]]+pull-requests:[[:space:]]+write' "$WF"
}

@test "claude-code-review.yml: prompt instructs --approve for acceptable code" {
  grep -qE 'gh pr review.*--approve' "$WF"
}

@test "claude-code-review.yml: prompt instructs --request-changes for issues" {
  grep -qE 'gh pr review.*--request-changes' "$WF"
}
