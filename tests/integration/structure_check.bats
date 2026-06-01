#!/usr/bin/env bats
# Integration tests for: structure enforcement (US-ONBOARD-004)
#
# Covers:
#   - Legacy structure (Roll-style BACKLOG.md / docs/features/) refuses project commands
#   - .roll/ structure allows all commands
#   - Empty dir / no structure allows all commands
#   - Exempt commands (setup, update, version, help, migrate, init, doctor) bypass check
#   - Detection walks from pwd up to git root
#   - ROLL_SKIP_STRUCTURE_CHECK=1 bypass works
#
# US-ONBOARD-019: refusal now requires a Roll-specific *content signature*, not
# just a matching file/directory name. Tests where we want to trigger refusal
# write Roll-style content; tests where we want the check to *allow* a non-Roll
# project use arbitrary content.

load helpers

setup() {
  integration_setup
  # These tests verify the check itself — undo the global bypass
  unset ROLL_SKIP_STRUCTURE_CHECK
  PROJECT_DIR="${TEST_TMP}/myproject"
  mkdir -p "$PROJECT_DIR"
  cd "$PROJECT_DIR"
  git init --quiet
  git config user.email "test@example.com"
  git config user.name "Test"
}

teardown() {
  integration_teardown
}

_run_roll() {
  HOME="${TEST_TMP}" ROLL_HOME="${ROLL_HOME}" bash "${ROLL_BIN}" "$@"
}

# Helper: write a BACKLOG.md whose content matches the Roll-1.x template, so
# the US-ONBOARD-019 signature check recognises it as a legitimate pre-2.0
# Roll project that still needs migration.
_write_roll_style_backlog() {
  cat > BACKLOG.md <<'EOF'
# Project Backlog

## Epic: Initial Setup
| Story | Description | Status |
|-------|-------------|--------|
| US-001 | example | Done |

## Bug Fixes
| ID | Problem | Status |
|----|---------|--------|
EOF
}

# ─── Legacy structure refuses project commands ───────────────────────────────

@test "structure: legacy Roll BACKLOG.md refuses 'roll status'" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  run _run_roll status
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
  [[ "$output" == *"roll migrate"* ]]
}

@test "structure: legacy docs/features/ with Roll-named files refuses 'roll backlog'" {
  mkdir -p docs/features
  echo "# feature" > docs/features/US-001-bootstrap.md
  git add -A && git commit --quiet -m "init"
  run _run_roll backlog
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
}

@test "structure: legacy Roll PROPOSALS.md refuses 'roll alert'" {
  cat > PROPOSALS.md <<'EOF'
# Proposals

## Proposal P-001: example
Details.
EOF
  git add -A && git commit --quiet -m "init"
  run _run_roll alert
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
}

# ─── US-ONBOARD-019: non-Roll projects are NOT misidentified ────────────────

@test "structure: non-Roll BACKLOG.md (random content) does not refuse commands" {
  # Project using BACKLOG.md from another tool (Trello dump / Jira export / etc.)
  cat > BACKLOG.md <<'EOF'
# Sprint backlog
- TASK-1: write spec
- TASK-2: ship feature
EOF
  git add -A && git commit --quiet -m "init"
  run _run_roll status
  [[ "$output" != *"Legacy structure detected"* ]]
  [[ "$output" != *"roll migrate"* ]]
}

@test "structure: generic docs/features/ folder does not refuse commands" {
  # Product docs site with a features folder — nothing to do with Roll.
  mkdir -p docs/features
  echo "# Auth" > docs/features/authentication.md
  echo "# Billing" > docs/features/billing.md
  git add -A && git commit --quiet -m "init"
  run _run_roll status
  [[ "$output" != *"Legacy structure detected"* ]]
}

@test "structure: arbitrary PROPOSALS.md does not refuse commands" {
  echo "# proposals from a teammate" > PROPOSALS.md
  git add -A && git commit --quiet -m "init"
  run _run_roll status
  [[ "$output" != *"Legacy structure detected"* ]]
}

# ─── .roll/ structure allows commands ──────────────────────────────────────

@test "structure: .roll/ present allows project commands" {
  mkdir -p .roll
  echo "x" > .roll/backlog.md
  git add -A && git commit --quiet -m "init"
  # Run a command that would be allowed structurally (it may still fail for
  # other reasons, but it should not be blocked by structure check)
  run _run_roll status
  # Either succeeds, or fails for non-structure reasons
  [[ "$output" != *"Legacy structure detected"* ]]
}

# ─── Exempt commands always allowed ─────────────────────────────────────────

@test "structure: 'version' exempt — works on legacy structure" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  run _run_roll version
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll v"* ]]
}

@test "structure: '--version' exempt" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  run _run_roll --version
  [ "$status" -eq 0 ]
}

@test "structure: '-v' exempt" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  run _run_roll -v
  [ "$status" -eq 0 ]
}

@test "structure: 'help' exempt — works on legacy structure" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  run _run_roll help
  [ "$status" -eq 0 ]
}

@test "structure: 'migrate' exempt — works on legacy structure" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  run _run_roll migrate --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" != *"Legacy structure detected"* ]]
}

@test "structure: 'init' exempt — works on legacy structure" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  # init may fail for other reasons but should not be blocked by structure
  run _run_roll init
  [[ "$output" != *"Legacy structure detected"* ]]
}

# ─── Directory traversal ─────────────────────────────────────────────────────

@test "structure: detects legacy structure from subdir (walks up to git root)" {
  _write_roll_style_backlog
  mkdir -p src/components
  git add -A && git commit --quiet -m "init"
  cd src/components
  run _run_roll status
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
}

# FIX-156: nested-repo escape — cwd inside `.roll/` (a nested roll-meta git
# repo) must not trip the legacy warning because the outer project's `.roll/`
# IS the new structure. Without the escape, `git rev-parse --show-toplevel`
# returns the inner `.roll/` git root, the existing `[[ -d "$root/.roll" ]]`
# check looks for `.roll/.roll` (which doesn't exist), and the legacy
# heuristic fires on the very file that defines `.roll/` itself.

@test "FIX-156: cwd inside .roll/ nested git repo does NOT trip legacy warning" {
  # Outer project with .roll/ as the new structure marker
  mkdir -p .roll
  echo "x" > .roll/backlog.md
  git add -A && git commit --quiet -m "outer init"

  # Inside .roll/, a nested git repo (mirrors roll-meta layout) with Roll-
  # style content that would normally trip the legacy detector
  cd .roll
  git init --quiet
  git config user.email "test@example.com"
  git config user.name "Test"
  # Write a BACKLOG.md whose content matches the Roll-1.x signature
  cat > BACKLOG.md <<'EOF'
# Project Backlog

## Epic: Initial Setup
| Story | Description | Status |
|-------|-------------|--------|
| US-001 | example | Done |

## Bug Fixes
| ID | Problem | Status |
|----|---------|--------|
EOF
  git add -A && git commit --quiet -m "inner init"

  # From inside .roll/, run a project command — must escape upward and find
  # the outer .roll/ marker, NOT report legacy structure.
  run _run_roll status
  [[ "$output" != *"Legacy structure detected"* ]]
  [[ "$output" != *"roll migrate"* ]]
}

@test "FIX-156: outer .roll/ takes precedence even when inner has legacy markers" {
  # Same setup as above; verify positive: command is allowed (exit may be
  # non-zero for command-specific reasons but never blocked by structure).
  mkdir -p .roll
  echo "x" > .roll/backlog.md
  git add -A && git commit --quiet -m "outer init"
  cd .roll
  git init --quiet
  git config user.email "test@example.com"
  git config user.name "Test"
  cat > BACKLOG.md <<'EOF'
# Project Backlog
## Bug Fixes
| ID | Problem | Status |
EOF
  git add -A && git commit --quiet -m "inner init"

  # `version` is exempt (always allowed) — used as a low-noise probe that
  # the check doesn't error out.
  run _run_roll version
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll v"* ]]
}

# ─── Empty/clean dir allows everything ──────────────────────────────────────

@test "structure: empty dir with no markers allows commands" {
  # Just an empty git repo
  echo "hello" > README.md
  git add -A && git commit --quiet -m "init"
  # Run a non-project command that should work everywhere
  run _run_roll version
  [ "$status" -eq 0 ]
}

# ─── Bypass env ─────────────────────────────────────────────────────────────

@test "structure: ROLL_SKIP_STRUCTURE_CHECK=1 bypasses the check" {
  _write_roll_style_backlog
  git add -A && git commit --quiet -m "init"
  ROLL_SKIP_STRUCTURE_CHECK=1 run _run_roll status
  # Should not be blocked by structure check; may fail for other reasons
  [[ "$output" != *"Legacy structure detected"* ]]
}
