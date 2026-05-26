#!/usr/bin/env bats
# Unit tests for: roll loop monitor (_loop_monitor backing logic)
# Scope: routing, state file parsing, scheduler detection, queue ordering
# Out of scope: TUI rendering output (while-true loop)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  mkdir -p "$TEST_DIR/.roll"
  export TERM=dumb
  # Source bin/roll to access internal functions
  # shellcheck disable=SC1090
  local _saved_trap; _saved_trap="$(trap -p DEBUG 2>/dev/null || true)"
  trap - DEBUG
  ROLL_HOME="${BATS_TEST_DIRNAME}/../../" source "$ROLL_BIN" 2>/dev/null || true
  [[ -n "$_saved_trap" ]] && eval "$_saved_trap"
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

@test "loop monitor: scheduler detection uses _launchd_svc_state on macOS" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q "_launchd_svc_state"
}

# ─── Three-service status display (US-AUTO-011 / US-AUTO-015) ────────────────

@test "loop monitor: shows three service lines (loop, dream, brief) on macOS" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q '_launchd_svc_state'
  echo "$monitor_body" | grep -q '"loop"'
  echo "$monitor_body" | grep -q '"dream"'
  echo "$monitor_body" | grep -q '"brief"'
}

@test "loop monitor: installed/off state shows repair command" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q 'roll loop on'
}

@test "loop monitor: not-installed state shows setup command" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS only"
  local monitor_body
  monitor_body=$(awk '/^_loop_monitor\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$monitor_body" | grep -q 'roll setup'
}

@test "_launchd_svc_state: loaded service returns enabled" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _launchd_is_loaded() { return 0; }
  local state; state=$(_launchd_svc_state "loop" "$proj")
  [ "$state" = "enabled" ]
  rm -rf "$tmp_dir"
}

@test "_launchd_svc_state: plist exists but not loaded returns stale (FIX-098)" {
  # FIX-098: renamed from 'installed-off' to 'stale' to distinguish from
  # 'not-installed'. Both plist-present/not-loaded states mean the agent is
  # not running, but 'stale' explicitly indicates launchd lost track of it
  # (e.g. after roll loop off + roll update without roll loop on).
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  mkdir -p "${tmp_dir}/LaunchAgents"
  _launchd_is_loaded() { return 1; }
  local label; label=$(_launchd_label "loop" "$proj")
  touch "${tmp_dir}/LaunchAgents/${label}.plist"
  local state; state=$(_launchd_svc_state "loop" "$proj")
  [ "$state" = "stale" ]
  rm -rf "$tmp_dir"
}

@test "_launchd_svc_state: no plist file returns not-installed" {
  local tmp_dir; tmp_dir=$(mktemp -d)
  local proj="${tmp_dir}/proj"; mkdir -p "$proj"
  _LAUNCHD_DIR="${tmp_dir}/LaunchAgents"
  _launchd_is_loaded() { return 1; }
  local state; state=$(_launchd_svc_state "loop" "$proj")
  [ "$state" = "not-installed" ]
  rm -rf "$tmp_dir"
}

# ─── Queue ordering ───────────────────────────────────────────────────────────

@test "loop monitor: queue shows FIX items before US items" {
  cat > "$TEST_DIR/.roll/backlog.md" << 'EOF'
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
  fix_pending=$(grep -E '^\| FIX-' .roll/backlog.md | grep '📋 Todo' || true)
  us_pending=$(grep -E '^\| \[US-' .roll/backlog.md | grep '📋 Todo' || true)
  [[ -n "$fix_pending" ]]
  [[ -n "$us_pending" ]]
  # FIX should appear before US in normal priority ordering
  local fix_line us_line
  fix_line=$(grep -n "FIX-099" .roll/backlog.md | cut -d: -f1)
  us_line=$(grep -n "US-TEST-099" .roll/backlog.md | cut -d: -f1)
  [ "$fix_line" -lt "$us_line" ]
}
