#!/usr/bin/env bats
# Unit tests for: roll status — Loop Overview section (US-AUTO-021)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
  export HOME="${TEST_DIR}"
  export ROLL_HOME="${TEST_DIR}/.roll"
  mkdir -p "${TEST_DIR}/.roll/conventions/global"
  mkdir -p "${TEST_DIR}/.roll/conventions/templates/fullstack"
  mkdir -p "${TEST_DIR}/.roll/conventions/templates/frontend-only"
  mkdir -p "${TEST_DIR}/.roll/conventions/templates/backend-service"
  mkdir -p "${TEST_DIR}/.roll/conventions/templates/cli"
  mkdir -p "${TEST_DIR}/.roll/skills"
  mkdir -p "${TEST_DIR}/Library/LaunchAgents"
  touch "${TEST_DIR}/.roll/config.yaml"
}

teardown() {
  rm -rf "$TEST_DIR"
}

_make_loop_plist() {
  local slug="$1" proj_path="$2" minute="${3:-5}" hour="${4:-}"
  local label="com.roll.loop.${slug}"
  local plist="${TEST_DIR}/Library/LaunchAgents/${label}.plist"
  local hour_xml=""
  [[ -n "$hour" ]] && hour_xml="    <key>Hour</key>
    <integer>${hour}</integer>
"
  cat > "$plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key>
    <integer>${minute}</integer>
${hour_xml}  </dict>
  <key>WorkingDirectory</key>
  <string>${proj_path}</string>
</dict>
</plist>
EOF
}

# ─── Skip when no plists ──────────────────────────────────────────────────────

@test "status loop overview: section skipped when no loop plists" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  [ "$status" -eq 0 ]
  ! echo "$output" | grep -q "Loop Overview"
}

# ─── Section appears when plists exist ───────────────────────────────────────

@test "status loop overview: section present when one plist exists" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  mkdir -p "${TEST_DIR}/myproject"
  _make_loop_plist "myproject-abc123" "${TEST_DIR}/myproject" 5
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "Loop Overview"
}

@test "status loop overview: shows project name from WorkingDirectory" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  mkdir -p "${TEST_DIR}/myproject"
  _make_loop_plist "myproject-abc123" "${TEST_DIR}/myproject" 5
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  echo "$output" | grep -q "myproject"
}

# ─── Path missing ─────────────────────────────────────────────────────────────

@test "status loop overview: shows (path missing) when project dir absent" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  _make_loop_plist "gone-abc123" "${TEST_DIR}/nonexistent-dir" 5
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "path missing"
}

# ─── Backlog todo count ───────────────────────────────────────────────────────

@test "status loop overview: shows todo count from BACKLOG.md" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  mkdir -p "${TEST_DIR}/myproject"
  _make_loop_plist "myproject-abc123" "${TEST_DIR}/myproject" 5
  cat > "${TEST_DIR}/myproject/BACKLOG.md" << 'BACKLOG'
| US-001 | Story one | 📋 Todo |
| US-002 | Story two | 📋 Todo |
| US-003 | Done item | ✅ Done |
BACKLOG
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  echo "$output" | grep -q "2 pending"
}

@test "status loop overview: shows 0 pending when no BACKLOG.md" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  mkdir -p "${TEST_DIR}/myproject"
  _make_loop_plist "myproject-abc123" "${TEST_DIR}/myproject" 5
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  echo "$output" | grep -q "0 pending"
}

# ─── Schedule display ─────────────────────────────────────────────────────────

@test "status loop overview: shows :MM format for minute-only schedule" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  mkdir -p "${TEST_DIR}/myproject"
  _make_loop_plist "myproject-abc123" "${TEST_DIR}/myproject" 15
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  echo "$output" | grep -q ":15"
}

@test "status loop overview: shows HH:MM format when hour is set" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  mkdir -p "${TEST_DIR}/myproject"
  _make_loop_plist "myproject-abc123" "${TEST_DIR}/myproject" 30 3
  ROLL_UI=v1 run bash "$ROLL_BIN" status
  echo "$output" | grep -q "03:30"
}
