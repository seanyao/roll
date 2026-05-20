#!/usr/bin/env bats
# Integration tests for: roll init (simplified — US-CLI-001)
# New behavior: no type prompt, no tool prompt, no scaffold — 3-step init only.
#   1. Fresh project  → creates AGENTS.md + .roll/backlog.md + .roll/features/
#   2. Existing AGENTS.md → re-merges global conventions (idempotent)

load helpers

setup() {
  integration_setup
  run_roll setup
  PROJECT_DIR="${TEST_TMP}/myproject"
  mkdir -p "$PROJECT_DIR"
}

teardown() {
  integration_teardown
}

# Helper: run roll init inside PROJECT_DIR — no stdin needed (no prompts)
roll_init() {
  bash -c "cd '${PROJECT_DIR}' && HOME='${TEST_TMP}' ROLL_HOME='${ROLL_HOME}' '${ROLL_BIN}' init"
}

# ─── Happy path: fresh project ─────────────────────────────────────────────────

@test "init: creates AGENTS.md in new project" {
  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/AGENTS.md" ]
}

@test "init: creates .roll/backlog.md in new project" {
  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/.roll/backlog.md" ]
}

@test "init: creates .roll/features/ in new project" {
  run roll_init
  [ "$status" -eq 0 ]
  [ -d "${PROJECT_DIR}/.roll/features" ]
}

# ─── Happy path: re-merge (existing AGENTS.md) ────────────────────────────────

@test "init: re-merge exits 0 when AGENTS.md already exists" {
  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/AGENTS.md" ]

  # Second init — no prompts, should succeed and preserve AGENTS.md
  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/AGENTS.md" ]
}

@test "init: backfills .roll/backlog.md when AGENTS.md exists but backlog is missing" {
  run roll_init
  [ "$status" -eq 0 ]
  rm -f "${PROJECT_DIR}/.roll/backlog.md"

  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/AGENTS.md" ]
  [ -f "${PROJECT_DIR}/.roll/backlog.md" ]
}

@test "init: backfills .roll/features when AGENTS.md exists but features dir is missing" {
  run roll_init
  [ "$status" -eq 0 ]
  rm -rf "${PROJECT_DIR}/docs"

  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/AGENTS.md" ]
  [ -d "${PROJECT_DIR}/.roll/features" ]
}

# ─── UX: clean completion message ────────────────────────────────────────────

@test "init: output includes 'Initialized' on success" {
  run roll_init
  [ "$status" -eq 0 ]
  [[ "$output" == *"Initialized"* ]]
}

@test "init: v2 UI shows .roll/backlog.md as a created step on fresh project (FIX-073)" {
  run roll_init
  [ "$status" -eq 0 ]
  # FIX-073 renderer prints ".roll/backlog.md" indented under its step header.
  [[ "$output" == *".roll/backlog.md"* ]]
  [[ "$output" == *"Create .roll/backlog.md"* ]]
}

@test "init: v2 UI shows .roll/features as a created step on fresh project (FIX-073)" {
  run roll_init
  [ "$status" -eq 0 ]
  [[ "$output" == *".roll/features"* ]]
  [[ "$output" == *"Create .roll/features"* ]]
}

# ─── Project-type-aware AGENTS.md merge ──────────────────────────────────────

@test "init: skips Frontend Default Stack for cli project" {
  mkdir -p "${PROJECT_DIR}/bin"
  run roll_init
  [ "$status" -eq 0 ]
  run grep -q "## 7. Frontend Default Stack" "${PROJECT_DIR}/AGENTS.md"
  [ "$status" -ne 0 ]
}

@test "init: includes Frontend Default Stack for frontend project" {
  mkdir -p "${PROJECT_DIR}/src"
  run roll_init
  [ "$status" -eq 0 ]
  grep -q "## 7. Frontend Default Stack" "${PROJECT_DIR}/AGENTS.md"
}

# ─── .claude/CLAUDE.md merge ─────────────────────────────────────────────────

@test "init: creates .claude/CLAUDE.md for cli project" {
  mkdir -p "${PROJECT_DIR}/bin"
  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/.claude/CLAUDE.md" ]
}

@test "init: .claude/CLAUDE.md creation is idempotent" {
  mkdir -p "${PROJECT_DIR}/bin"
  run roll_init
  [ "$status" -eq 0 ]
  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${PROJECT_DIR}/.claude/CLAUDE.md" ]
}

@test "init: skips .claude/CLAUDE.md for unknown project type" {
  run roll_init
  [ "$status" -eq 0 ]
  [ ! -f "${PROJECT_DIR}/.claude/CLAUDE.md" ]
}

# ─── opencode sync ────────────────────────────────────────────────────────────

@test "init: syncs AGENTS.md to opencode dir when binary exists" {
  mkdir -p "${TEST_TMP}/.opencode/bin"
  touch "${TEST_TMP}/.opencode/bin/opencode"
  chmod +x "${TEST_TMP}/.opencode/bin/opencode"

  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.config/opencode/roll.md" ]
}

@test "init: appends @roll.md to opencode AGENTS.md when binary exists" {
  mkdir -p "${TEST_TMP}/.opencode/bin"
  touch "${TEST_TMP}/.opencode/bin/opencode"
  chmod +x "${TEST_TMP}/.opencode/bin/opencode"

  run roll_init
  [ "$status" -eq 0 ]
  [ -f "${TEST_TMP}/.config/opencode/AGENTS.md" ]
  grep -qF "@roll.md" "${TEST_TMP}/.config/opencode/AGENTS.md"
}

@test "init: opencode sync is idempotent" {
  mkdir -p "${TEST_TMP}/.opencode/bin"
  touch "${TEST_TMP}/.opencode/bin/opencode"
  chmod +x "${TEST_TMP}/.opencode/bin/opencode"

  run roll_init
  [ "$status" -eq 0 ]
  run roll_init
  [ "$status" -eq 0 ]
  local count
  count=$(grep -cF "@roll.md" "${TEST_TMP}/.config/opencode/AGENTS.md")
  [ "$count" -eq 1 ]
}

@test "init: does not create opencode dir when opencode is not installed" {
  if command -v opencode &>/dev/null; then
    skip "opencode is installed on this system"
  fi
  run roll_init
  [ "$status" -eq 0 ]
  [ ! -f "${TEST_TMP}/.config/opencode/roll.md" ]
}

# ─── Error path ────────────────────────────────────────────────────────────────

@test "init: exits non-zero when templates not found (setup not run)" {
  local empty_roll="${TEST_TMP}/empty_roll"
  mkdir -p "$empty_roll"
  run bash -c "cd '${PROJECT_DIR}' && HOME='${TEST_TMP}' ROLL_HOME='${empty_roll}' '${ROLL_BIN}' init"
  [ "$status" -ne 0 ]
}
