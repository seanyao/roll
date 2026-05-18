#!/usr/bin/env bats
# Integration tests for: structure enforcement (US-ONBOARD-004)
#
# Covers:
#   - Legacy structure (BACKLOG.md / docs/features/ etc.) refuses project commands
#   - .roll/ structure allows all commands
#   - Empty dir / no structure allows all commands
#   - Exempt commands (setup, update, version, help, migrate, init, doctor) bypass check
#   - Detection walks from pwd up to git root
#   - ROLL_SKIP_STRUCTURE_CHECK=1 bypass works

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

# ─── Legacy structure refuses project commands ───────────────────────────────

@test "structure: legacy BACKLOG.md refuses 'roll status'" {
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  run _run_roll status
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
  [[ "$output" == *"roll migrate"* ]]
}

@test "structure: legacy docs/features/ refuses 'roll backlog'" {
  mkdir -p docs/features
  echo "f" > docs/features/feat1.md
  git add -A && git commit --quiet -m "init"
  run _run_roll backlog
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
}

@test "structure: legacy PROPOSALS.md refuses 'roll alert'" {
  echo "p" > PROPOSALS.md
  git add -A && git commit --quiet -m "init"
  run _run_roll alert
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
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
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  run _run_roll version
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll v"* ]]
}

@test "structure: '--version' exempt" {
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  run _run_roll --version
  [ "$status" -eq 0 ]
}

@test "structure: '-v' exempt" {
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  run _run_roll -v
  [ "$status" -eq 0 ]
}

@test "structure: 'help' exempt — works on legacy structure" {
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  run _run_roll help
  [ "$status" -eq 0 ]
}

@test "structure: 'migrate' exempt — works on legacy structure" {
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  run _run_roll migrate --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" != *"Legacy structure detected"* ]]
}

@test "structure: 'init' exempt — works on legacy structure" {
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  # init may fail for other reasons but should not be blocked by structure
  run _run_roll init
  [[ "$output" != *"Legacy structure detected"* ]]
}

# ─── Directory traversal ─────────────────────────────────────────────────────

@test "structure: detects legacy structure from subdir (walks up to git root)" {
  echo "backlog" > BACKLOG.md
  mkdir -p src/components
  git add -A && git commit --quiet -m "init"
  cd src/components
  run _run_roll status
  [ "$status" -ne 0 ]
  [[ "$output" == *"Legacy structure detected"* ]]
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
  echo "backlog" > BACKLOG.md
  git add -A && git commit --quiet -m "init"
  ROLL_SKIP_STRUCTURE_CHECK=1 run _run_roll status
  # Should not be blocked by structure check; may fail for other reasons
  [[ "$output" != *"Legacy structure detected"* ]]
}
