#!/usr/bin/env bats
# US-PR-004: integration E2E for `roll doctor` — runs the real binary in a
# sandboxed cwd to cover the golden path users actually hit.

load helpers

setup() { integration_setup; }
teardown() { integration_teardown; }

@test "roll doctor: succeeds inside a git repo and emits the PR review extras section" {
  cd "$TEST_TMP"
  git init -q
  PATH="/usr/bin:/bin" run_roll doctor
  [ "$status" -eq 0 ]
  # Section header is bilingual; assert both anchors so the EN/ZH split convention is locked.
  [[ "$output" == *"PR review extras"* ]]
  [[ "$output" == *"PR 评审两档开关"* ]]
}

@test "roll doctor: outside a git repo prints nothing PR-related and exits 0" {
  cd "$TEST_TMP"
  PATH="/usr/bin:/bin" run_roll doctor
  [ "$status" -eq 0 ]
  [[ "$output" != *"PR review extras"* ]]
  [[ "$output" != *"PR 评审两档开关"* ]]
  [[ "$output" != *"required_pull_request_reviews"* ]]
  [[ "$output" != *"pr-review-event.yml"* ]]
}

@test "roll doctor: workflow file present → ✅ event-driven shown, install command suppressed" {
  cd "$TEST_TMP"
  git init -q
  mkdir -p .github/workflows
  echo "name: pr-review-event" > .github/workflows/pr-review-event.yml
  PATH="/usr/bin:/bin" run_roll doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"Event-driven PR review installed"* ]]
  [[ "$output" != *"cp templates/workflows/pr-review-event.yml"* ]]
}
