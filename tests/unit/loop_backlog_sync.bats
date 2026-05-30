#!/usr/bin/env bats
# US-SYNC-008: _loop_backlog_sync_hook — roll-loop cycle preflight optionally
# pulls fresh GitHub issues into the backlog when backlog_sync.on_loop_cycle is
# true. Default off; fail-soft (ALERT, never blocks the cycle).

load helpers
setup()    { unit_setup; }
teardown() { unit_teardown; }

# Build a minimal project with backlog + local.yaml + an issues fixture.
_make_proj() {
  local proj="$1"
  mkdir -p "${proj}/.roll/features"
  cat > "${proj}/.roll/backlog.md" << 'EOF'
# Project Backlog

## Epic: Synced
### Feature: github-issues-sync
| Story | Description | Status |
|-------|-------------|--------|
| [US-EXISTING-001](.roll/features/x.md) | An existing story | 📋 Todo |
EOF
  cat > "${proj}/issues.json" << 'EOF'
[
  {"number": 99, "title": "Synced via loop cycle", "state": "open",
   "labels": [{"name": "enhancement"}]}
]
EOF
}

@test "_loop_backlog_sync_hook: function exists in bin/roll" {
  declare -f _loop_backlog_sync_hook | grep -q "_loop_backlog_sync_hook"
}

@test "on_loop_cycle absent: no-op, backlog unchanged (default off)" {
  local proj="${TEST_TMP}/proj-off"
  _make_proj "$proj"
  # local.yaml with NO backlog_sync block at all
  printf 'agent: claude\n' > "${proj}/.roll/local.yaml"
  export ROLL_SYNC_FIXTURE="${proj}/issues.json"
  export CYCLE_ID="c-off"
  local before; before=$(cat "${proj}/.roll/backlog.md")
  run _loop_backlog_sync_hook "$proj"
  [ "$status" -eq 0 ]
  local after; after=$(cat "${proj}/.roll/backlog.md")
  [ "$before" = "$after" ]
  ! grep -q "Synced via loop cycle" "${proj}/.roll/backlog.md"
}

@test "on_loop_cycle false: no-op, no sync performed" {
  local proj="${TEST_TMP}/proj-false"
  _make_proj "$proj"
  cat > "${proj}/.roll/local.yaml" << 'EOF'
backlog_sync:
  repo: seanyao/roll-meta
  on_loop_cycle: false
EOF
  export ROLL_SYNC_FIXTURE="${proj}/issues.json"
  export CYCLE_ID="c-false"
  run _loop_backlog_sync_hook "$proj"
  [ "$status" -eq 0 ]
  ! grep -q "Synced via loop cycle" "${proj}/.roll/backlog.md"
}

@test "on_loop_cycle true: pulls issues into backlog once" {
  local proj="${TEST_TMP}/proj-on"
  _make_proj "$proj"
  cat > "${proj}/.roll/local.yaml" << 'EOF'
backlog_sync:
  repo: seanyao/roll-meta
  on_loop_cycle: true
EOF
  export ROLL_SYNC_FIXTURE="${proj}/issues.json"
  export CYCLE_ID="c-on"
  run _loop_backlog_sync_hook "$proj"
  [ "$status" -eq 0 ]
  grep -q "Synced via loop cycle" "${proj}/.roll/backlog.md"
}

@test "on_loop_cycle true but sync fails: ALERT written, cycle continues (exit 0)" {
  local proj="${TEST_TMP}/proj-fail"
  _make_proj "$proj"
  # on_loop_cycle true but NO repo configured and no --repo => sync exits non-zero
  cat > "${proj}/.roll/local.yaml" << 'EOF'
backlog_sync:
  on_loop_cycle: true
EOF
  # No fixture and no repo -> sync usage error (non-zero).
  unset ROLL_SYNC_FIXTURE
  export CYCLE_ID="c-fail"
  export _LOOP_ALERT="${TEST_TMP}/ALERT-fail.md"
  run _loop_backlog_sync_hook "$proj"
  [ "$status" -eq 0 ]
  [ -f "$_LOOP_ALERT" ]
  grep -q "backlog sync failed" "$_LOOP_ALERT"
  unset _LOOP_ALERT
}

@test "inner runner template calls _loop_backlog_sync_hook in preflight" {
  local runner="${TEST_TMP}/run-test-bsync.sh"
  _write_loop_runner_script "$runner" "${TEST_TMP}/fake-proj" "echo hi" "${TEST_TMP}/log"
  local inner="${runner%.sh}-inner.sh"
  [ -f "$inner" ]
  grep -q '_loop_backlog_sync_hook' "$inner"
}

@test "github_sync.py on-loop-cycle: prints false for absent key" {
  local yaml="${TEST_TMP}/no-flag.yaml"
  printf 'backlog_sync:\n  repo: a/b\n' > "$yaml"
  run python3 "${ROLL_BIN%/bin/roll}/lib/github_sync.py" on-loop-cycle --local-yaml "$yaml"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

@test "github_sync.py on-loop-cycle: prints true when set true" {
  local yaml="${TEST_TMP}/on-flag.yaml"
  printf 'backlog_sync:\n  repo: a/b\n  on_loop_cycle: true\n' > "$yaml"
  run python3 "${ROLL_BIN%/bin/roll}/lib/github_sync.py" on-loop-cycle --local-yaml "$yaml"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}
