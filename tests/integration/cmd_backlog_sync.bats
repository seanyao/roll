#!/usr/bin/env bats
# Integration (E2E) tests for: roll backlog sync (US-SYNC-002)
# Golden path: mock GitHub issues → `roll backlog sync` → rows appended to
# backlog.md with label→type mapping and state→status mapping.
# A JSON fixture (ROLL_SYNC_FIXTURE) stands in for the live GitHub API so the
# full bin/roll → lib/github_sync.py write path runs with zero network access.

load helpers

setup() {
  integration_setup
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  integration_teardown
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
EOF
}

_make_fixture() {
  cat > "${TEST_TMP}/issues.json" << 'EOF'
[
  {"number": 13, "title": "Add GitHub Issues sync", "state": "open",
   "labels": [{"name": "enhancement"}]},
  {"number": 14, "title": "Crash on empty repo", "state": "open",
   "labels": [{"name": "bug"}]},
  {"number": 15, "title": "Untidy module structure", "state": "closed",
   "labels": [{"name": "refactor"}]},
  {"number": 16, "title": "No label issue", "state": "open",
   "labels": []}
]
EOF
  export ROLL_SYNC_FIXTURE="${TEST_TMP}/issues.json"
}

# ── Golden path ───────────────────────────────────────────────────────────────

@test "backlog sync e2e: appends a row for each issue" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta
  [ "$status" -eq 0 ]
  grep -q "Add GitHub Issues sync" "${TEST_TMP}/.roll/backlog.md"
  grep -q "Crash on empty repo" "${TEST_TMP}/.roll/backlog.md"
}

@test "backlog sync e2e: maps bug label to FIX prefix" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta
  [ "$status" -eq 0 ]
  grep -qE '^\| FIX-14 \| Crash on empty repo \| 📋 Todo \|$' "${TEST_TMP}/.roll/backlog.md"
}

@test "backlog sync e2e: maps enhancement label to US prefix" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta
  [ "$status" -eq 0 ]
  grep -qE '^\| US-13 \| Add GitHub Issues sync \| 📋 Todo \|$' "${TEST_TMP}/.roll/backlog.md"
}

@test "backlog sync e2e: maps refactor label and closed state" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta
  [ "$status" -eq 0 ]
  grep -qE '^\| REFACTOR-15 \| Untidy module structure \| ✅ Done \|$' "${TEST_TMP}/.roll/backlog.md"
}

@test "backlog sync e2e: unlabeled issue defaults to US" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta
  [ "$status" -eq 0 ]
  grep -qE '^\| US-16 \| No label issue \| 📋 Todo \|$' "${TEST_TMP}/.roll/backlog.md"
}

@test "backlog sync e2e: preexisting rows are preserved" {
  _make_sync_backlog
  _make_fixture
  run_roll backlog sync --repo seanyao/roll-meta
  [ "$status" -eq 0 ]
  grep -q "An existing story" "${TEST_TMP}/.roll/backlog.md"
}
