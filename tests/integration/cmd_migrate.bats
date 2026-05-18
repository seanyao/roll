#!/usr/bin/env bats
# Integration tests for: roll migrate (US-ONBOARD-003)
#
# Covers:
#   - Three-state idempotency: old-only / new-only / both / neither
#   - Dry-run preview (no filesystem changes)
#   - Single atomic commit on success
#   - git history preservation (--follow)
#   - Precondition: clean working tree required
#   - Precondition: must be inside a git repo

load helpers

setup() {
  integration_setup
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

# Helper: create a typical "old-structure" project with files in all migration sources.
_make_old_structure() {
  echo "initial" > README.md
  mkdir -p docs/features docs/briefs docs/dream docs/design docs/domain \
           docs/practices docs/intro docs/guide/en docs/guide/zh docs/site
  echo "backlog" > BACKLOG.md
  echo "proposals" > PROPOSALS.md
  echo "f1" > docs/features.md
  echo "f2" > docs/features/feat1.md
  echo "b1" > docs/briefs/2026-01.md
  echo "d1" > docs/dream/2026-01.md
  echo "des" > docs/design/idea-1.md
  echo "dom" > docs/domain/context-map.md
  echo "v" > docs/practices/loop-autorun-verification.md
  echo "r" > docs/practices/engineering-common-sense.md
  echo "<html>" > docs/intro/roll-intro.html
  echo "en" > docs/guide/en/overview.md
  echo "zh" > docs/guide/zh/overview.md
  echo "site" > docs/site/index.html
  git add -A && git commit --quiet -m "initial"
}

# Helper: run roll migrate with given args
_run_migrate() {
  HOME="${TEST_TMP}" ROLL_HOME="${ROLL_HOME}" bash "${ROLL_BIN}" migrate "$@"
}

# ─── Three-state idempotency ───────────────────────────────────────────────

@test "migrate: state=old-only — executes migration" {
  _make_old_structure
  run _run_migrate
  [ "$status" -eq 0 ]
  [[ "$output" == *"Migrated 14 paths"* ]] || [[ "$output" == *"已在单 commit 中迁移 14"* ]]
}

@test "migrate: state=new-only — no-op with already-migrated message" {
  mkdir -p .roll
  echo "fake" > .roll/backlog.md
  git add -A && git commit --quiet -m "fake post-migration"
  run _run_migrate
  [ "$status" -eq 0 ]
  [[ "$output" == *"Already migrated"* ]]
}

@test "migrate: state=both — errors with conflict list" {
  _make_old_structure
  mkdir -p .roll
  echo "stray" > .roll/backlog.md
  git add -A && git commit --quiet -m "stray .roll"
  run _run_migrate
  [ "$status" -ne 0 ]
  [[ "$output" == *"Both old and new structures exist"* ]]
  [[ "$output" == *"BACKLOG.md"* ]] && [[ "$output" == *".roll/backlog.md"* ]]
}

@test "migrate: state=neither — no-op with nothing-to-migrate message" {
  echo "hello" > README.md
  git add -A && git commit --quiet -m "clean"
  run _run_migrate
  [ "$status" -eq 0 ]
  [[ "$output" == *"No old structure detected"* ]]
}

# ─── Dry-run ────────────────────────────────────────────────────────────────

@test "migrate: --dry-run shows preview without modifying files" {
  _make_old_structure
  local before; before=$(git log -1 --format=%H)
  run _run_migrate --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry-run"* ]]
  [[ "$output" == *"BACKLOG.md"* ]]
  [[ "$output" == *".roll/backlog.md"* ]]
  local after; after=$(git log -1 --format=%H)
  [ "$before" = "$after" ]
  [ -f "BACKLOG.md" ]
  [ ! -d ".roll" ]
}

@test "migrate: -n is alias for --dry-run" {
  _make_old_structure
  run _run_migrate -n
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry-run"* ]]
  [ -f "BACKLOG.md" ]
}

# ─── Atomic commit ──────────────────────────────────────────────────────────

@test "migrate: produces single commit on success" {
  _make_old_structure
  local before_count; before_count=$(git rev-list --count HEAD)
  _run_migrate >/dev/null
  local after_count; after_count=$(git rev-list --count HEAD)
  [ "$after_count" -eq "$((before_count + 1))" ]
}

@test "migrate: commit message references the migration" {
  _make_old_structure
  _run_migrate >/dev/null
  run git log -1 --format=%s
  [ "$status" -eq 0 ]
  [[ "$output" == *"Migrate project layout"* ]] || [[ "$output" == *".roll/"* ]]
}

# ─── History preservation ──────────────────────────────────────────────────

@test "migrate: git history --follow tracks files across rename" {
  _make_old_structure
  _run_migrate >/dev/null
  # .roll/features/feat1.md should be traceable back to docs/features/feat1.md
  run git log --follow --oneline .roll/features/feat1.md
  [ "$status" -eq 0 ]
  local count; count=$(echo "$output" | grep -c .)
  [ "$count" -ge 2 ]
}

# ─── Final structure ─────────────────────────────────────────────────────────

@test "migrate: produces correct target structure (no nested dirs)" {
  _make_old_structure
  _run_migrate >/dev/null
  # Files should land at correct positions, not nested (e.g., NOT site/site/index.html)
  [ -f ".roll/backlog.md" ]
  [ -f ".roll/proposals.md" ]
  [ -f ".roll/features.md" ]
  [ -f ".roll/features/feat1.md" ]
  [ -f ".roll/briefs/2026-01.md" ]
  [ -f ".roll/dream/2026-01.md" ]
  [ -f ".roll/design/idea-1.md" ]
  [ -f ".roll/domain/context-map.md" ]
  [ -f ".roll/verification/loop-autorun-verification.md" ]
  [ -f "guide/en/overview.md" ]
  [ -f "guide/en/practices/engineering-common-sense.md" ]
  [ -f "guide/zh/overview.md" ]
  [ -f "site/index.html" ]
  [ -f "site/slides/roll-intro.html" ]
  # Negative: nesting bugs we explicitly avoided
  [ ! -e "site/site" ]
  [ ! -e "guide/en/en" ]
  # docs/ should be cleaned up (empty dir removal)
  [ ! -d "docs" ]
}

# ─── Preconditions ─────────────────────────────────────────────────────────

@test "migrate: refuses if working tree dirty" {
  _make_old_structure
  echo "dirty" >> README.md  # uncommitted change
  run _run_migrate
  [ "$status" -ne 0 ]
  [[ "$output" == *"Working tree not clean"* ]]
}

@test "migrate: refuses outside git repo" {
  rm -rf .git
  run _run_migrate
  [ "$status" -ne 0 ]
  [[ "$output" == *"Not a git repository"* ]]
}

# ─── Help ──────────────────────────────────────────────────────────────────

@test "migrate: --help prints usage" {
  run _run_migrate --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: roll migrate"* ]]
  [[ "$output" == *"Three-state idempotency"* ]]
}
