#!/usr/bin/env bats
# US-AUTO-035: roll setup prints the branch-protection hint so the human
# can flip path A (CI only) → path C (CI + AI review double gate).

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

@test "_print_pr_pipeline_hint: mentions required_pull_request_reviews" {
  run _print_pr_pipeline_hint
  [ "$status" -eq 0 ]
  [[ "$output" == *"required_pull_request_reviews"* ]]
}

@test "_print_pr_pipeline_hint: includes a runnable gh api PATCH command" {
  run _print_pr_pipeline_hint
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh api"* ]]
  [[ "$output" == *"PATCH"* ]]
  [[ "$output" == *"branches/main/protection"* ]]
}

@test "_print_pr_pipeline_hint: bilingual EN/ZH on separate lines" {
  # Project convention (AGENTS.md): bilingual output uses separate lines.
  run _print_pr_pipeline_hint
  [ "$status" -eq 0 ]
  # At least one English line and one Chinese line.
  echo "$output" | grep -qE '[A-Za-z]'
  echo "$output" | grep -qE '[一-龥]'
}

@test "cmd_setup output references the PR-pipeline hint" {
  # Smoke check that cmd_setup ends with the hint. Avoid full side effects
  # by stubbing the internal helpers — only the hint function should reach
  # stdout for our assertion.
  _install_local() { :; }
  _sync_conventions() { :; }
  _sync_skills() { :; }
  _peer_ensure_state_dir() { :; }
  _ensure_tmux() { :; }
  _install_launchd_plists() { :; }

  run cmd_setup
  [ "$status" -eq 0 ]
  [[ "$output" == *"required_pull_request_reviews"* ]]
}
