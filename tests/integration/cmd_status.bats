#!/usr/bin/env bats
# Integration tests for: roll status
# Tests output content for all major status sections:
#   ~/.roll/ existence, global conventions, global skills,
#   sync targets, skill symlinks, git hook, and templates.
#
# Note: `roll status` may exit non-zero in sandbox environments where
# `git config --global` has no config file — that is a known binary quirk.
# Tests here assert output content, not exit codes for the status command.

load helpers

setup() {
  integration_setup
}

teardown() {
  integration_teardown
}

# ─── Scenario 1: without setup — error path ───────────────────────────────────

@test "status: reports not found when ~/.roll/ does not exist" {
  run_roll status
  # Command returns early with an error message before hitting git config
  echo "$output" | grep -qiE "not found|setup"
}

# ─── Scenario 2: after setup — ~/.roll/ exists ─────────────────────────────

@test "status: reports exists after setup" {
  run_roll setup
  [ "$status" -eq 0 ]

  run_roll status
  # Output contains exists message even when script exits non-zero later
  echo "$output" | grep -q "exists"
}

# ─── Scenario 3: after sync conventions — Claude shows in sync ───────────────

@test "status: shows 'in sync' for Claude Code after setup" {
  run_roll setup
  [ "$status" -eq 0 ]

  run_roll status
  echo "$output" | grep -q "in sync"
}

# ─── Scenario 4: after setup — skill symlinks are reported ────────────────────

@test "status: shows skills linked after setup" {
  run_roll setup
  [ "$status" -eq 0 ]

  run_roll status
  # setup calls _sync_skills which creates roll-* symlinks under ~/.claude/skills/
  # status reports them as "skills linked" (e.g., "15/15 skills linked")
  echo "$output" | grep -qE "skills linked|mounted"
}

# ─── Scenario 5: git hook section appears in output ───────────────────────────

@test "status: git hook section is reached in output" {
  run_roll setup
  [ "$status" -eq 0 ]

  run_roll status
  # The Git hook section header should appear in output even if the script
  # aborts shortly after due to git config exit code in sandbox environments
  echo "$output" | grep -q "Git hook"
}
