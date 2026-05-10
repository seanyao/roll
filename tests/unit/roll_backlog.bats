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
  cat > "$TEST_DIR/BACKLOG.md" << 'EOF'
# Project Backlog

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-001 | Fix something | ✅ Done |

## Epic: Test
### Feature: test
| Story | Description | Status |
|-------|-------------|--------|
| [US-TEST-001](docs/features/test.md#us-test-001) | Done story | ✅ Done |

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
  echo "| FIX-002 | Pending fix | 📋 Todo |" >> "$TEST_DIR/BACKLOG.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"FIX-002"* ]]
}

@test "backlog: pending US item shows User Stories section" {
  _make_backlog
  echo "| [US-TEST-002](docs/features/test.md#us-test-002) | Pending story | 📋 Todo |" >> "$TEST_DIR/BACKLOG.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  [[ "$output" == *"US-TEST-002"* ]]
}

@test "backlog: FIX appears before US in output" {
  _make_backlog
  echo "| FIX-003 | Pending fix | 📋 Todo |" >> "$TEST_DIR/BACKLOG.md"
  echo "| [US-TEST-003](docs/features/test.md) | Pending story | 📋 Todo |" >> "$TEST_DIR/BACKLOG.md"
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -eq 0 ]
  fix_pos=$(echo "$output" | grep -n "FIX-003" | cut -d: -f1)
  us_pos=$(echo "$output" | grep -n "US-TEST-003" | cut -d: -f1)
  [ "$fix_pos" -lt "$us_pos" ]
}

@test "backlog: missing BACKLOG.md exits non-zero with error" {
  cd "$TEST_DIR"
  run bash "$ROLL_BIN" backlog
  [ "$status" -ne 0 ]
}
