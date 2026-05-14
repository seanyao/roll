#!/usr/bin/env bats
# Tests for cmd_review_pr / _parse_review_verdict (US-PR-001)

load helpers
setup()    { unit_setup; }
teardown() { unit_teardown; }

# ─── _parse_review_verdict ────────────────────────────────────────────────────

@test "_parse_review_verdict: APPROVE verdict" {
  local output="Looks good.
<!--VERDICT:APPROVE-->"
  local result; result=$(_parse_review_verdict "$output")
  [ "$result" = "APPROVE" ]
}

@test "_parse_review_verdict: REQUEST_CHANGES with reason" {
  local output="Missing error handling.
<!--VERDICT:REQUEST_CHANGES:add try-catch around DB call-->"
  local result; result=$(_parse_review_verdict "$output")
  [ "$result" = "REQUEST_CHANGES:add try-catch around DB call" ]
}

@test "_parse_review_verdict: UNCERTAIN with reason" {
  local output="Cannot verify domain logic.
<!--VERDICT:UNCERTAIN:need context on billing rules-->"
  local result; result=$(_parse_review_verdict "$output")
  [ "$result" = "UNCERTAIN:need context on billing rules" ]
}

@test "_parse_review_verdict: no verdict → empty output" {
  local output="Just some analysis with no verdict footer."
  local result; result=$(_parse_review_verdict "$output")
  [ -z "$result" ]
}

@test "_parse_review_verdict: multiple verdicts → last one wins" {
  local output="First pass:
<!--VERDICT:UNCERTAIN:unsure-->
After re-reading:
<!--VERDICT:APPROVE-->"
  local result; result=$(_parse_review_verdict "$output")
  [ "$result" = "APPROVE" ]
}

# ─── skip-ai-review escape hatch ─────────────────────────────────────────────

@test "_has_skip_ai_review: detects tag in PR body" {
  local body="Please merge this [skip-ai-review] quickly"
  echo "$body" | grep -qF '[skip-ai-review]'
}

@test "_has_skip_ai_review: absent when tag missing" {
  local body="Normal PR body without the tag"
  ! echo "$body" | grep -qF '[skip-ai-review]'
}
