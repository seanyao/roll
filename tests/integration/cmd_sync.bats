#!/usr/bin/env bats
# Integration tests for: roll sync [-f]
# Tests convention file syncing, skill symlink creation, and idempotency.
# roll sync always syncs both conventions and skills in one step.

load helpers

setup() {
  integration_setup
  # Ensure WK_HOME exists before sync (setup populates conventions/skills)
  run_wk setup
}

teardown() {
  integration_teardown
}

# ─── sync: conventions written ────────────────────────────────────────────────

@test "sync: wk.md is written to ~/.claude/" {
  run_wk sync
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.claude/wk.md" ]
}

@test "sync: wk.md content matches ROLL_HOME/conventions/global/CLAUDE.md" {
  run_wk sync
  [ "$status" -eq 0 ]
  diff "${ROLL_HOME}/conventions/global/CLAUDE.md" "${TEST_TMP}/.claude/wk.md"
}

# ─── sync: @wk.md appended to CLAUDE.md ──────────────────────────────────────

@test "sync: @wk.md is present in ~/.claude/CLAUDE.md" {
  run_wk sync
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.claude/CLAUDE.md" ]
  grep -qF "@wk.md" "${TEST_TMP}/.claude/CLAUDE.md"
}

# ─── sync: idempotent (@wk.md not duplicated) ────────────────────────────────

@test "sync: @wk.md is not duplicated when synced twice" {
  run_wk sync
  [ "$status" -eq 0 ]
  run_wk sync
  [ "$status" -eq 0 ]
  local count
  count=$(grep -cF "@wk.md" "${TEST_TMP}/.claude/CLAUDE.md")
  [ "$count" -eq 1 ]
}

# ─── sync: missing AI tool dir is not created ────────────────────────────────

@test "sync: absent ~/.gemini/ is not recreated by sync" {
  rm -rf "${TEST_TMP}/.gemini"
  run_wk sync
  [ "$status" -eq 0 ]
  [ ! -d "${TEST_TMP}/.gemini" ]
}

# ─── sync: skill symlinks exist ──────────────────────────────────────────────

@test "sync: ~/.claude/skills/ contains roll-* symlinks" {
  run_wk sync
  [ "$status" -eq 0 ]
  local count
  count=$(find "${TEST_TMP}/.claude/skills" -maxdepth 1 -mindepth 1 -type l -name "roll-*" | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}

# ─── sync: both conventions and skills applied in one call ───────────────────

@test "sync: wk.md and roll-* symlinks both exist after single sync" {
  run_wk sync
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.claude/wk.md" ]
  local count
  count=$(find "${TEST_TMP}/.claude/skills" -maxdepth 1 -mindepth 1 -type l -name "roll-*" | wc -l | tr -d ' ')
  [ "$count" -gt 0 ]
}
