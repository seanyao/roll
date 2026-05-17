#!/usr/bin/env bats
# US-PR-004: roll doctor surfaces the PR review extras section (was: cmd_setup hints).
# Tests live in unit because they exercise cmd_doctor with stubbed helpers — no
# global filesystem mutation, no real gh calls.

load helpers

setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── Section visibility ──────────────────────────────────────────────────────

@test "cmd_doctor: prints PR review extras section header when inside a git repo" {
  git init -q "${TEST_TMP}"
  # Stub gh probe and workflow probe so this test only asserts the header.
  _doctor_branch_protection_state() { echo "unknown"; }
  _doctor_event_workflow_state() { echo "absent"; }

  run cmd_doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"PR review extras"* ]] || [[ "$output" == *"PR 评审两档开关"* ]]
}

@test "cmd_doctor: branch protection enabled → ✅ shown and pipeline hint suppressed" {
  git init -q "${TEST_TMP}"
  _doctor_branch_protection_state() { echo "enabled"; }
  _doctor_event_workflow_state() { echo "absent"; }

  run cmd_doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"AI review double gate enabled"* ]]
  # When enabled, the install command must NOT be reprinted
  [[ "$output" != *"required_pull_request_reviews"* ]]
}

@test "cmd_doctor: branch protection disabled → ⚪ shown with pipeline hint" {
  git init -q "${TEST_TMP}"
  _doctor_branch_protection_state() { echo "disabled"; }
  _doctor_event_workflow_state() { echo "absent"; }

  run cmd_doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"double gate not enabled"* ]]
  [[ "$output" == *"required_pull_request_reviews"* ]]
}

@test "cmd_doctor: branch protection unknown (no gh / unauth) → ⚪ with hint, no failure" {
  git init -q "${TEST_TMP}"
  _doctor_branch_protection_state() { echo "unknown"; }
  _doctor_event_workflow_state() { echo "absent"; }

  run cmd_doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"state unknown"* ]]
  [[ "$output" == *"gh auth"* ]]
  [[ "$output" == *"required_pull_request_reviews"* ]]
}

@test "cmd_doctor: event workflow present → ✅ shown and event hint suppressed" {
  git init -q "${TEST_TMP}"
  mkdir -p .github/workflows
  echo "name: pr-review-event" > .github/workflows/pr-review-event.yml
  _doctor_branch_protection_state() { echo "unknown"; }

  run cmd_doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"Event-driven PR review installed"* ]]
  # When installed, the install command must NOT be reprinted
  [[ "$output" != *"cp templates/workflows/pr-review-event.yml"* ]]
}

@test "cmd_doctor: event workflow absent → ⚪ shown with event hint" {
  git init -q "${TEST_TMP}"
  _doctor_branch_protection_state() { echo "unknown"; }

  run cmd_doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"Event-driven PR review not installed"* ]]
  [[ "$output" == *"pr-review-event.yml"* ]]
}

# ─── Probe helpers ───────────────────────────────────────────────────────────

@test "_doctor_event_workflow_state: returns present when workflow file exists" {
  git init -q "${TEST_TMP}"
  mkdir -p .github/workflows
  echo "name: x" > .github/workflows/pr-review-event.yml

  run _doctor_event_workflow_state
  [ "$status" -eq 0 ]
  [ "$output" = "present" ]
}

@test "_doctor_event_workflow_state: returns absent when workflow file missing" {
  run _doctor_event_workflow_state
  [ "$status" -eq 0 ]
  [ "$output" = "absent" ]
}

@test "_doctor_branch_protection_state: returns unknown when gh is missing" {
  # Stub `command` so command -v gh fails — both the lookup and any side-effect
  # gh call are short-circuited at the first guard.
  command() {
    if [[ "$1" = "-v" && "$2" = "gh" ]]; then
      return 1
    fi
    builtin command "$@"
  }

  run _doctor_branch_protection_state
  [ "$status" -eq 0 ]
  [ "$output" = "unknown" ]
}

@test "cmd_doctor: skips the PR section silently when not in a git repo" {
  # TEST_TMP is a fresh dir, not a repo
  _doctor_branch_protection_state() { echo "unknown"; }
  _doctor_event_workflow_state() { echo "absent"; }

  run cmd_doctor
  [ "$status" -eq 0 ]
  [[ "$output" != *"PR review extras"* ]]
  [[ "$output" != *"PR 评审两档开关"* ]]
  # No leaked install commands either
  [[ "$output" != *"required_pull_request_reviews"* ]]
  [[ "$output" != *"pr-review-event.yml"* ]]
}
