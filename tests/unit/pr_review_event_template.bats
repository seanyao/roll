#!/usr/bin/env bats
# Tests for pr-review-event.yml template and setup hint (US-PR-003).

load helpers
setup() { unit_setup; }
teardown() { unit_teardown; }

# ─── Template file structure ─────────────────────────────────────────────────

@test "pr-review-event.yml: template exists" {
  [ -f "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml" ]
}

@test "pr-review-event.yml: triggers on pull_request events" {
  grep -q "pull_request:" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
  grep -q "opened" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
  grep -q "synchronize" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
  grep -q "reopened" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
}

@test "pr-review-event.yml: skips fork PRs" {
  grep -q "fork == false" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
}

@test "pr-review-event.yml: respects skip-ai-review escape hatch" {
  grep -q "skip-ai-review" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
}

@test "pr-review-event.yml: calls roll review-pr" {
  grep -q "roll review-pr" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
}

@test "pr-review-event.yml: does not have branches-ignore for loop" {
  ! grep -q "branches-ignore" "${ROLL_PKG_DIR}/templates/workflows/pr-review-event.yml"
}

# ─── Setup hint ──────────────────────────────────────────────────────────────

@test "_print_pr_event_hint: outputs install command" {
  run _print_pr_event_hint
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "pr-review-event.yml"
  echo "$output" | grep -q ".github/workflows"
}
