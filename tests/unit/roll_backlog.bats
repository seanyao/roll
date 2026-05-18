#!/usr/bin/env bats
# Unit tests for: roll backlog command (cmd_backlog)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
FIXTURES_DIR="${BATS_TEST_DIRNAME}/../fixtures"

setup() {
  TEST_DIR="$(mktemp -d)"
  export HOME_ORIG="$HOME"
  # Suppress color codes in output
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  rm -rf "$TEST_DIR"
}

_make_backlog() {
  cat > "$TEST_DIR/.roll/backlog.md" << 'EOF'
# Project Backlog

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-001 | Fix something | ✅ Done |

## Epic: Test
### Feature: test
| Story | Description | Status |
|-------|-------------|--------|
| [US-TEST-001](.roll/features/test.md#us-test-001) | Done story | ✅ Done |

## ♻️ Refactor
| ID | Description | Status |
|----|-------------|--------|
EOF
}

@test "backlog: all done shows clear message" {
  _make_backlog
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"clear"* ]] || [[ "$output" == *"Nothing pending"* ]]
}

@test "backlog: pending FIX item shows Bug Fixes section" {
  _make_backlog
  echo "| FIX-002 | Pending fix | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-002"* ]]
}

@test "backlog: pending US item shows User Stories section" {
  _make_backlog
  echo "| [US-TEST-002](.roll/features/test.md#us-test-002) | Pending story | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-TEST-002"* ]]
}

@test "backlog: FIX appears before US in output" {
  _make_backlog
  echo "| FIX-003 | Pending fix | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  echo "| [US-TEST-003](.roll/features/test.md) | Pending story | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  fix_pos=$(echo "$output" | grep -n "FIX-003" | cut -d: -f1)
  us_pos=$(echo "$output" | grep -n "US-TEST-003" | cut -d: -f1)
  [ "$fix_pos" -lt "$us_pos" ]
}

@test "backlog: pending REFACTOR item shows Refactors section" {
  _make_backlog
  echo "| REFACTOR-001 | Pending refactor | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"REFACTOR-001"* ]]
  [[ "$output" == *"Refactors"* ]]
  [[ "$output" == *"Pending refactor"* ]]
}

@test "backlog: pending IDEA item shows Ideas section" {
  _make_backlog
  echo "| IDEA-001 | Pending idea | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"IDEA-001"* ]]
  [[ "$output" == *"Ideas"* ]]
  [[ "$output" == *"Pending idea"* ]]
}

@test "backlog: four group types all render in priority order FIX→US→REFACTOR→IDEA" {
  _make_backlog
  echo "| IDEA-009 | An idea | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  echo "| REFACTOR-009 | A refactor | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  echo "| [US-TEST-009](.roll/features/test.md) | A story | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  echo "| FIX-009 | A fix | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  fix_pos=$(echo "$output" | grep -n "FIX-009" | cut -d: -f1)
  us_pos=$(echo "$output" | grep -n "US-TEST-009" | cut -d: -f1)
  refactor_pos=$(echo "$output" | grep -n "REFACTOR-009" | cut -d: -f1)
  idea_pos=$(echo "$output" | grep -n "IDEA-009" | cut -d: -f1)
  [ "$fix_pos" -lt "$us_pos" ]
  [ "$us_pos" -lt "$refactor_pos" ]
  [ "$refactor_pos" -lt "$idea_pos" ]
}

@test "backlog: missing .roll/backlog.md exits non-zero with error" {
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -ne 0 ]
}

@test "backlog v2: ROLL_UI=v2 routes to Python implementation" {
  _make_backlog
  echo "| FIX-010 | A pending fix | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-010"* ]]
  [[ "$output" == *"Bug Fixes"* ]]
}

@test "backlog v2: ROLL_UI=v1 uses legacy bash implementation" {
  _make_backlog
  echo "| FIX-011 | A pending fix for v1 | 📋 Todo |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run env ROLL_UI=v1 bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-011"* ]]
}

@test "backlog v2: in-progress item shows pulse marker" {
  _make_backlog
  echo "| [US-TEST-020](.roll/features/test.md) | Active story | 🔨 In Progress |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-TEST-020"* ]]
  [[ "$output" == *"⏵"* ]]
}

@test "backlog v2: blocked item shows lock emoji and reason" {
  _make_backlog
  echo "| FIX-012 | A blocked fix | 🔒 Blocked [waiting on infra] |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-012"* ]]
  [[ "$output" == *"🔒"* ]]
}

@test "backlog v2: deferred item shows pause emoji" {
  _make_backlog
  echo "| IDEA-050 | Deferred idea | ⏸ Deferred [low priority] |" >> "$TEST_DIR/.roll/backlog.md"
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"IDEA-050"* ]]
  [[ "$output" == *"⏸"* ]]
}
