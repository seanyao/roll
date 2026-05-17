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
  # At least one English line and one Chinese line. Literal anchors keep this
  # portable across locales (the regex class [一-龥] is brittle on CI shells
  # without a UTF-8 grep locale).
  [[ "$output" == *"required_pull_request_reviews"* ]]
  [[ "$output" == *"可选"* ]]
  [[ "$output" == *"紧急通道"* ]]
}

@test "cmd_setup output does NOT reprint the PR-pipeline hint (moved to doctor)" {
  # US-PR-004: hints moved out of setup; setup now stays terse on upgrade.
  _install_local() { :; }
  _sync_conventions() { :; }
  _sync_skills() { :; }
  _peer_ensure_state_dir() { :; }
  _ensure_tmux() { :; }
  _install_launchd_plists() { :; }

  run cmd_setup
  [ "$status" -eq 0 ]
  [[ "$output" != *"required_pull_request_reviews"* ]]
}

@test "cmd_setup output does NOT reprint the PR-event hint (moved to doctor)" {
  _install_local() { :; }
  _sync_conventions() { :; }
  _sync_skills() { :; }
  _peer_ensure_state_dir() { :; }
  _ensure_tmux() { :; }
  _install_launchd_plists() { :; }

  run cmd_setup
  [ "$status" -eq 0 ]
  [[ "$output" != *"pr-review-event.yml"* ]]
}

@test "cmd_update path stays terse — no PR hints leaked through cmd_setup" {
  # cmd_update calls cmd_setup. The historical bug (IDEA-022): both hints
  # were reprinted on every `roll update`. US-PR-004 moves them to doctor.
  _install_local() { :; }
  _sync_conventions() { :; }
  _sync_skills() { :; }
  _peer_ensure_state_dir() { :; }
  _ensure_tmux() { :; }
  _install_launchd_plists() { :; }
  npm() { return 0; }  # stub npm install / view
  _check_installed_version_or_retry() { :; }
  _show_changelog() { :; }

  run cmd_update
  [ "$status" -eq 0 ]
  [[ "$output" != *"required_pull_request_reviews"* ]]
  [[ "$output" != *"pr-review-event.yml"* ]]
}
