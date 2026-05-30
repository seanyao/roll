#!/usr/bin/env bats
# Integration (E2E) tests for: roll backlog sync --dry-run (US-SYNC-004)
# A --dry-run pass fetches issues and prints what WOULD be added/skipped, but
# never touches backlog.md. A JSON fixture (ROLL_SYNC_FIXTURE) stands in for
# the live GitHub API so the full bin/roll → lib/github_sync.py path runs with
# zero network access.

load helpers

setup() {
  integration_setup
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  integration_teardown
}

# Portable mtime in seconds. NOTE: on GNU/Linux `stat -f` stats the FILESYSTEM
# (and exits 0), so a `stat -f ... || stat -c ...` fallback silently reads the
# wrong thing — branch on `uname` instead.
_file_mtime() {
  if [[ "$(uname)" == "Darwin" ]]; then
    stat -f %m "$1"
  else
    stat -c %Y "$1"
  fi
}

_make_sync_backlog() {
  mkdir -p "${TEST_TMP}/.roll/features"
  cat > "${TEST_TMP}/.roll/backlog.md" << 'EOF'
# Project Backlog

## Epic: Synced
### Feature: github-issues-sync
| Story | Description | Status |
|-------|-------------|--------|
| [US-EXISTING-001](.roll/features/x.md) | An existing story | 📋 Todo |
| US-GH-13 | Already synced earlier | 📋 Todo |
EOF
}

_make_fixture() {
  cat > "${TEST_TMP}/issues.json" << 'EOF'
[
  {"number": 13, "title": "Add GitHub Issues sync", "state": "open",
   "labels": [{"name": "enhancement"}]},
  {"number": 14, "title": "Crash on empty repo", "state": "open",
   "labels": [{"name": "bug"}]}
]
EOF
  export ROLL_SYNC_FIXTURE="${TEST_TMP}/issues.json"
}

# ── Dry-run never writes ──────────────────────────────────────────────────────

@test "backlog sync --dry-run: backlog.md content is unchanged" {
  _make_sync_backlog
  _make_fixture
  local before
  before=$(cat "${TEST_TMP}/.roll/backlog.md")
  run_roll backlog sync --repo seanyao/roll-meta --dry-run
  [ "$status" -eq 0 ]
  local after
  after=$(cat "${TEST_TMP}/.roll/backlog.md")
  [ "$before" = "$after" ]
  # The new issue (GH-14) must NOT have been written.
  ! grep -q "Crash on empty repo" "${TEST_TMP}/.roll/backlog.md"
}

@test "backlog sync --dry-run: running twice does not change mtime" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta --dry-run
  [ "$status" -eq 0 ]
  local mtime1
  mtime1=$(_file_mtime "${TEST_TMP}/.roll/backlog.md")
  run_roll backlog sync --repo seanyao/roll-meta --dry-run
  [ "$status" -eq 0 ]
  local mtime2
  mtime2=$(_file_mtime "${TEST_TMP}/.roll/backlog.md")
  [ "$mtime1" = "$mtime2" ]
}

# ── Dry-run preview output ────────────────────────────────────────────────────

@test "backlog sync --dry-run: prints + line for a new issue" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"+ GH-14 [FIX] Crash on empty repo"* ]]
}

@test "backlog sync --dry-run: prints = (skipped) line for an existing issue" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"= GH-13 [US] (skipped, already exists)"* ]]
}

@test "backlog sync --dry-run: exit code 0 on success" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta --dry-run
  [ "$status" -eq 0 ]
}
