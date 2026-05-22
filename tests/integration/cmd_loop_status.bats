#!/usr/bin/env bats
# E2E for US-VIEW-012 golden path: dashboard's per-cycle token column
# renders as input/output (work-done tokens only); cache_creation and
# cache_read stay in events.ndjson for cost math but never surface in UI.
# Cycles without a usage event render as —/—.

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

setup() {
  TEST_TMP="$(mktemp -d)"
  mkdir -p "$TEST_TMP/loop"
  export ROLL_SHARED_ROOT="$TEST_TMP"
  cd "$TEST_TMP"
  git init -q
  git config user.email t@t.t
  git config user.name T
  mkdir -p .roll
  : > .roll/backlog.md
}

teardown() { rm -rf "${TEST_TMP:-}"; }

slug_for_cwd() {
  python3 -c "
import sys; sys.path.insert(0, '${LIB}')
import importlib.util
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.project_slug('${TEST_TMP}'))
"
}

@test "E2E US-VIEW-017: cycle row shows all 4 token components (in/cw↑ cr↓/out)" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  local ts1="2026-05-21T10:00:00Z"
  local ts2="2026-05-21T10:18:00Z"
  # input=1.234M, output=567K, cache_write=9.876M (→9.9M↑), cache_read=8.765M (→8.8M↓)
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"LT","outcome":"ok","detail":""}
{"ts":"${ts1}","stage":"usage","label":"LT","outcome":"ok","detail":{"model":"claude-opus-4-7","input_tokens":1234000,"output_tokens":567000,"cache_creation_tokens":9876000,"cache_read_tokens":8765000,"cost_reported_usd":0,"duration_ms":1080000}}
{"ts":"${ts2}","stage":"pr","label":"LT","outcome":"ok","detail":"https://github.com/x/y/pull/12 US-VIEW-012"}
{"ts":"${ts2}","stage":"cycle_end","label":"LT","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  # cycle row: 4-part format in/cw↑ cr↓/out
  [[ "$output" == *"1.2M"* ]]
  [[ "$output" == *"9.9M↑"* ]]
  [[ "$output" == *"8.8M↓"* ]]
  [[ "$output" == *"567K"* ]]
  # rollup rows present
  [[ "$output" == *"cache writes"* ]]
  [[ "$output" == *"cache reads"* ]]
}

@test "FIX-095: status with no launchd plist renders 'not installed'" {
  # No plist in HOME/Library/LaunchAgents → _detect_install_state returns
  # 'not-installed' → eyebrow shows '○ not installed'.
  run env NO_COLOR=1 HOME="$TEST_TMP" ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" \
    python3 "$STATUS" --no-color --en
  [ "$status" -eq 0 ]
  [[ "$output" == *"not installed"* ]]
  # And explicitly NOT the legacy '● IDLE  next run' wording when uninstalled.
  [[ "$output" != *"● IDLE   next run"* ]]
}

@test "FIX-095/FIX-098: status with plist present and launchd print success renders 'enabled'" {
  # FIX-098: _detect_install_state now uses `launchctl print gui/<uid>/<label>`
  # (exit 0 = loaded) instead of print-disabled. We stub launchctl print to
  # return exit 0 so the test runs without requiring a real launchd agent.
  local slug; slug=$(slug_for_cwd)
  mkdir -p "$TEST_TMP/Library/LaunchAgents"
  cat > "$TEST_TMP/Library/LaunchAgents/com.roll.loop.${slug}.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.roll.loop.${slug}</string>
  <key>StartCalendarInterval</key><dict><key>Minute</key><integer>17</integer></dict>
</dict></plist>
EOF
  local shim="$TEST_TMP/bin"
  mkdir -p "$shim"
  # Stub: `launchctl print gui/<uid>/<label>` returns exit 0 (agent loaded).
  cat > "$shim/launchctl" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "print" ]]; then
  exit 0
fi
exit 0
SH
  chmod +x "$shim/launchctl"

  run env NO_COLOR=1 HOME="$TEST_TMP" ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" \
    PATH="$shim:$PATH" python3 "$STATUS" --no-color --en
  [ "$status" -eq 0 ]
  [[ "$output" == *"enabled"* ]]
  [[ "$output" != *"not installed"* ]]
  [[ "$output" != *"STALE"* ]]
}

@test "FIX-098/FIX-095: status with plist present but agent not loaded renders 'STALE'" {
  # FIX-098 updated _detect_install_state() to use `launchctl print` (actual registry)
  # rather than `launchctl print-disabled` (disabled-overrides DB). This test validates
  # that when launchctl print returns non-zero (agent not loaded), the dashboard
  # renders the STALE eyebrow instead of IDLE or 'installed/off'.
  local slug; slug=$(slug_for_cwd)
  mkdir -p "$TEST_TMP/Library/LaunchAgents"
  : > "$TEST_TMP/Library/LaunchAgents/com.roll.loop.${slug}.plist"

  local shim="$TEST_TMP/bin"
  mkdir -p "$shim"
  # Stub: `launchctl print gui/<uid>/<label>` returns exit 1 (not loaded in launchd).
  # All other launchctl calls succeed silently.
  cat > "$shim/launchctl" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "print" ]]; then
  # Simulate agent NOT registered in launchd
  exit 1
fi
exit 0
SH
  chmod +x "$shim/launchctl"

  run env NO_COLOR=1 HOME="$TEST_TMP" ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" \
    PATH="$shim:$PATH" python3 "$STATUS" --no-color --en
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE"* ]]
}

@test "E2E US-VIEW-012: cycle without usage event renders as —/—" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  local ts1="2026-05-21T11:00:00Z"
  local ts2="2026-05-21T11:12:00Z"
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"LN","outcome":"ok","detail":""}
{"ts":"${ts2}","stage":"pr","label":"LN","outcome":"ok","detail":"https://github.com/x/y/pull/13 US-VIEW-012"}
{"ts":"${ts2}","stage":"cycle_end","label":"LN","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  [[ "$output" == *"—/—"* ]]
}
