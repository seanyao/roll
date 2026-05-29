#!/usr/bin/env bats
# FIX-143: _loop_gc 行为测试 — .bak 清理 + 孤儿 slug state 文件回收

load helpers

setup() {
  unit_setup_cd
  # Fake a shared loop data directory under TEST_TMP
  export _SHARED_ROOT="${TEST_TMP}/shared"
  mkdir -p "${_SHARED_ROOT}/loop"
  # Stub err/ok helpers to avoid noise
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  ok()   { echo "OK: $*"; }
  info() { echo "INFO: $*"; }
  # Sandbox HOME so LaunchAgents glob won't hit real files
  export HOME="${TEST_TMP}/fake-home"
  mkdir -p "${HOME}/Library/LaunchAgents"
  # Unset cycle-context env so gc is allowed
  unset ROLL_LOOP_AGENT ROLL_CYCLE_LOG_RAW
}

teardown() {
  unset ROLL_LOOP_AGENT ROLL_CYCLE_LOG_RAW ROLL_LOOP_GC_RETENTION_DAYS
  unit_teardown_cd
}

# ─── .bak 清理 ─────────────────────────────────────────────────────────────

@test "gc: removes events-*.ndjson.bak older than 30 days" {
  local loop_dir="${_SHARED_ROOT}/loop"
  local old_epoch; old_epoch=$(date -v-40d +%s 2>/dev/null || date -d '40 days ago' +%s)
  touch -t "$(date -v-40d +%Y%m%d%H%M 2>/dev/null || date -d '40 days ago' +%Y%m%d%H%M)" \
    "${loop_dir}/events-roll-ecf079.ndjson.bak"

  run _loop_gc
  [ "$status" -eq 0 ]
  [ ! -f "${loop_dir}/events-roll-ecf079.ndjson.bak" ]
}

@test "gc: removes runs.jsonl.bak older than 30 days" {
  local loop_dir="${_SHARED_ROOT}/loop"
  touch -t "$(date -v-40d +%Y%m%d%H%M 2>/dev/null || date -d '40 days ago' +%Y%m%d%H%M)" \
    "${loop_dir}/runs.jsonl.bak"

  run _loop_gc
  [ "$status" -eq 0 ]
  [ ! -f "${loop_dir}/runs.jsonl.bak" ]
}

@test "gc: keeps .bak within 30 days" {
  local loop_dir="${_SHARED_ROOT}/loop"
  touch "${loop_dir}/events-roll-ecf079.ndjson.bak"

  run _loop_gc
  [ "$status" -eq 0 ]
  [ -f "${loop_dir}/events-roll-ecf079.ndjson.bak" ]
}

@test "gc: .bak respects --keep-days 7 (removes at 8 days)" {
  local loop_dir="${_SHARED_ROOT}/loop"
  touch -t "$(date -v-8d +%Y%m%d%H%M 2>/dev/null || date -d '8 days ago' +%Y%m%d%H%M)" \
    "${loop_dir}/runs.jsonl.bak"
  touch -t "$(date -v-5d +%Y%m%d%H%M 2>/dev/null || date -d '5 days ago' +%Y%m%d%H%M)" \
    "${loop_dir}/events-roll-ecf079.ndjson.bak"

  run _loop_gc --keep-days 7
  [ "$status" -eq 0 ]
  [ ! -f "${loop_dir}/runs.jsonl.bak" ]           # 8 days → removed
  [ -f "${loop_dir}/events-roll-ecf079.ndjson.bak" ] # 5 days → kept
}

@test "gc: --dry-run lists .bak without removing" {
  local loop_dir="${_SHARED_ROOT}/loop"
  touch -t "$(date -v-40d +%Y%m%d%H%M 2>/dev/null || date -d '40 days ago' +%Y%m%d%H%M)" \
    "${loop_dir}/runs.jsonl.bak"

  run _loop_gc --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY-RUN"* ]]
  [[ "$output" == *"runs.jsonl.bak"* ]]
  [ -f "${loop_dir}/runs.jsonl.bak" ]  # not actually removed
}

# ─── 孤儿 slug state 文件清理 ─────────────────────────────────────────────

@test "gc: archives orphan slug plist and removes state/runs/events/cron files" {
  local loop_dir="${_SHARED_ROOT}/loop"

  # Simulate a dead project with a plist pointing to a non-existent directory
  local dead_slug="roll-deadbeef"
  local plist_path="${HOME}/Library/LaunchAgents/com.roll.loop.${dead_slug}.plist"
  local fake_proj="${TEST_TMP}/nonexistent-project"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>WorkingDirectory</key>
    <string>${fake_proj}</string>
</dict>
</plist>
EOF

  # Create orphan slug files in shared
  touch -t "$(date -v-1d +%Y%m%d%H%M 2>/dev/null || date -d '1 day ago' +%Y%m%d%H%M)" \
    "${loop_dir}/state-${dead_slug}.yaml"
  touch "${loop_dir}/runs-${dead_slug}.jsonl"
  touch "${loop_dir}/events-${dead_slug}.ndjson"
  touch "${loop_dir}/cron-${dead_slug}.log"

  run _loop_gc
  [ "$status" -eq 0 ]

  # state file removed
  [ ! -f "${loop_dir}/state-${dead_slug}.yaml" ]
  # runs file removed
  [ ! -f "${loop_dir}/runs-${dead_slug}.jsonl" ]
  # events file removed
  [ ! -f "${loop_dir}/events-${dead_slug}.ndjson" ]
  # cron log removed
  [ ! -f "${loop_dir}/cron-${dead_slug}.log" ]
  # plist archived (moved away)
  [ ! -f "$plist_path" ]
}

@test "gc: --dry-run lists orphan slug state files without removing" {
  local loop_dir="${_SHARED_ROOT}/loop"
  local dead_slug="roll-cafebabe"
  local plist_path="${HOME}/Library/LaunchAgents/com.roll.loop.${dead_slug}.plist"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>WorkingDirectory</key>
    <string>${TEST_TMP}/nowhere</string>
</dict>
</plist>
EOF

  touch "${loop_dir}/state-${dead_slug}.yaml"
  touch "${loop_dir}/runs-${dead_slug}.jsonl"

  run _loop_gc --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY-RUN"* ]]
  [[ "$output" == *"${dead_slug}"* ]]
  # Files not actually removed
  [ -f "${loop_dir}/state-${dead_slug}.yaml" ]
  [ -f "${loop_dir}/runs-${dead_slug}.jsonl" ]
  [ -f "$plist_path" ]
}

# ─── 回归: 已有清理行为不受影响 ──────────────────────────────────────────

@test "gc: still removes runs.jsonl.tmp.* debris" {
  local loop_dir="${_SHARED_ROOT}/loop"
  touch "${loop_dir}/runs.jsonl.tmp.abc123"

  run _loop_gc
  [ "$status" -eq 0 ]
  [ ! -f "${loop_dir}/runs.jsonl.tmp.abc123" ]
}

@test "gc: still archives orphan plist + runner scripts" {
  local loop_dir="${_SHARED_ROOT}/loop"
  local dead_slug="roll-000aaa"
  local plist_path="${HOME}/Library/LaunchAgents/com.roll.loop.${dead_slug}.plist"
  local fake_proj="${TEST_TMP}/gone-project"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>WorkingDirectory</key>
    <string>${fake_proj}</string>
</dict>
</plist>
EOF

  touch "${loop_dir}/run-${dead_slug}.sh"
  touch "${loop_dir}/run-${dead_slug}-inner.sh"
  touch "${loop_dir}/state-${dead_slug}.yaml"
  touch "${loop_dir}/runs-${dead_slug}.jsonl"

  run _loop_gc
  [ "$status" -eq 0 ]

  # Runner scripts moved to archive
  [ ! -f "${loop_dir}/run-${dead_slug}.sh" ]
  [ ! -f "${loop_dir}/run-${dead_slug}-inner.sh" ]
  # state/runs removed (not archived, just deleted since they're data files)
  [ ! -f "${loop_dir}/state-${dead_slug}.yaml" ]
  [ ! -f "${loop_dir}/runs-${dead_slug}.jsonl" ]
}

@test "gc: does not touch active project's state/runs files" {
  local loop_dir="${_SHARED_ROOT}/loop"
  local live_slug="roll-live999"
  local live_proj="${TEST_TMP}/live-project"
  mkdir -p "$live_proj"
  local plist_path="${HOME}/Library/LaunchAgents/com.roll.loop.${live_slug}.plist"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>WorkingDirectory</key>
    <string>${live_proj}</string>
</dict>
</plist>
EOF

  touch "${loop_dir}/state-${live_slug}.yaml"
  touch "${loop_dir}/runs-${live_slug}.jsonl"

  run _loop_gc
  [ "$status" -eq 0 ]

  # Live project's files should still exist
  [ -f "${loop_dir}/state-${live_slug}.yaml" ]
  [ -f "${loop_dir}/runs-${live_slug}.jsonl" ]
}
