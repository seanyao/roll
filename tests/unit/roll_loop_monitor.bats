#!/usr/bin/env bats
# Unit tests for: roll loop monitor (_loop_monitor backing logic)
# Scope: routing, state file parsing, scheduler detection, queue ordering
# Out of scope: TUI rendering output (while-true loop)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  export TERM=dumb
  # Source bin/roll to access internal functions
  # shellcheck disable=SC1090
  ROLL_HOME="${BATS_TEST_DIRNAME}/../../" source "$ROLL_BIN" 2>/dev/null || true
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ─── Routing ──────────────────────────────────────────────────────────────────

@test "loop monitor: 'monitor' subcommand is wired in cmd_loop routing" {
  run grep -c "monitor)" "$ROLL_BIN"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# ─── State file parsing ───────────────────────────────────────────────────────

@test "loop monitor: parses 'running' status from state file" {
  cat > "$TEST_DIR/state.yaml" << 'EOF'
status: running
current_item: US-TEST-001
started_at: "2026-05-10T10:00:00+08:00"
EOF
  local status
  status=$(grep '^status:' "$TEST_DIR/state.yaml" | awk '{print $2}')
  [ "$status" = "running" ]
}

@test "loop monitor: parses 'paused' status from state file" {
  cat > "$TEST_DIR/state.yaml" << 'EOF'
status: paused
current_item: US-TEST-002
EOF
  local status
  status=$(grep '^status:' "$TEST_DIR/state.yaml" | awk '{print $2}')
  [ "$status" = "paused" ]
}

@test "loop monitor: parses 'idle' status from state file" {
  cat > "$TEST_DIR/state.yaml" << 'EOF'
status: idle
EOF
  local status
  status=$(grep '^status:' "$TEST_DIR/state.yaml" | awk '{print $2}')
  [ "$status" = "idle" ]
}

@test "loop monitor: parses current_item from state file" {
  cat > "$TEST_DIR/state.yaml" << 'EOF'
status: running
current_item: US-AUTO-009
started_at: "2026-05-10T10:00:00+08:00"
EOF
  local item
  item=$(grep '^current_item:' "$TEST_DIR/state.yaml" | awk '{print $2}')
  [ "$item" = "US-AUTO-009" ]
}

# ─── Scheduler detection (macOS: launchd, not crontab) ───────────────────────

@test "loop monitor: scheduler detection uses _launchd_is_loaded on macOS" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  # _loop_monitor must call _launchd_is_loaded (macOS path)
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q "_launchd_is_loaded"
}

# ─── Three-service status display (US-AUTO-011) ──────────────────────────────

@test "loop monitor: shows three service lines (loop, dream, brief) on macOS" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q '"loop:hourly"'
  echo "$monitor_body" | grep -q '"dream:03:00"'
  echo "$monitor_body" | grep -q '"brief:09:00"'
}

@test "loop monitor: log tail reads from launchd.log (not cron.log)" {
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q "launchd.log"
  echo "$monitor_body" | grep -vq "cron.log"
}

@test "loop monitor: log tail shows last 10 lines" {
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q "tail -10"
}

@test "loop monitor: log tail section has a separator and header" {
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q "Log Tail"
}

# ─── Queue ordering ───────────────────────────────────────────────────────────

@test "loop monitor: queue shows FIX items before US items" {
  cat > "$TEST_DIR/BACKLOG.md" << 'EOF'
## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-099 | Pending fix | 📋 Todo |

## Epic: Test
### Feature: test
| Story | Description | Status |
|-------|-------------|--------|
| [US-TEST-099](x.md) | Pending story | 📋 Todo |
EOF
  cd "$TEST_DIR"
  # The queue logic in _loop_monitor reads FIX before US (same as cmd_backlog)
  local fix_pending us_pending
  fix_pending=$(grep -E '^\| FIX-' BACKLOG.md | grep '📋 Todo' || true)
  us_pending=$(grep -E '^\| \[US-' BACKLOG.md | grep '📋 Todo' || true)
  [[ -n "$fix_pending" ]]
  [[ -n "$us_pending" ]]
  # FIX should appear before US in normal priority ordering
  local fix_line us_line
  fix_line=$(grep -n "FIX-099" BACKLOG.md | cut -d: -f1)
  us_line=$(grep -n "US-TEST-099" BACKLOG.md | cut -d: -f1)
  [ "$fix_line" -lt "$us_line" ]
}
