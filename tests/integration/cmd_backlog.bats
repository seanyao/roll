#!/usr/bin/env bats
# Integration (E2E) tests for: roll backlog v2 redesign (US-VIEW-005)
# Golden path: user sees categorized backlog with in-progress pulse marker.

load helpers

setup() {
  integration_setup
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  integration_teardown
}

_make_project_backlog() {
  mkdir -p "${TEST_TMP}/docs/features"
  cat > "${TEST_TMP}/BACKLOG.md" << 'EOF'
# Project Backlog

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-001 | Fix a blocking regression | 📋 Todo |
| FIX-002 | Fix an active bug being worked on | 🔨 In Progress |
| FIX-003 | Fix something deferred | ⏸ Deferred [not urgent] |

## Epic: Core
### Feature: core
| Story | Description | Status |
|-------|-------------|--------|
| [US-CORE-001](docs/features/core.md) | Add core feature | 📋 Todo |
| [US-CORE-002](docs/features/core.md) | Another core feature | ✅ Done |

## ♻️ Refactor
| ID | Description | Status |
|----|-------------|--------|
| REFACTOR-001 | Clean up helper module | 📋 Todo |

## 💡 Ideas
| ID | Description | Status |
|----|-------------|--------|
| IDEA-001 | Explore new approach | 📋 Todo |
EOF
}

# ── Golden path ───────────────────────────────────────────────────────────────

@test "backlog e2e: v2 shows Bug Fixes section for FIX Todo items" {
  _make_project_backlog
  run_roll backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"Bug Fixes"* ]]
  [[ "$output" == *"FIX-001"* ]]
}

@test "backlog e2e: v2 shows in-progress item with pulse marker" {
  _make_project_backlog
  run_roll backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-002"* ]]
  [[ "$output" == *"⏵"* ]]
}

@test "backlog e2e: v2 shows User Stories section" {
  _make_project_backlog
  run_roll backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"User Stories"* ]]
  [[ "$output" == *"US-CORE-001"* ]]
  # Done story not listed
  [[ "$output" != *"US-CORE-002"* ]]
}

@test "backlog e2e: v2 shows Refactors and Ideas sections" {
  _make_project_backlog
  run_roll backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"Refactors"* ]]
  [[ "$output" == *"REFACTOR-001"* ]]
  [[ "$output" == *"Ideas"* ]]
  [[ "$output" == *"IDEA-001"* ]]
}

@test "backlog e2e: v2 shows deferred item in Deferred section" {
  _make_project_backlog
  run_roll backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"⏸"* ]]
  [[ "$output" == *"FIX-003"* ]]
}

@test "backlog e2e: subcommands (block/defer/unblock) still work in v2" {
  _make_project_backlog
  run_roll backlog block FIX-001 "needs infra"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Updated"* ]] || [[ "$output" == *"1 item"* ]]
}
