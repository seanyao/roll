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
