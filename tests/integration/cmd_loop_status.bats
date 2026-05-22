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

@test "E2E US-VIEW-012: cycle row shows input/output tokens, cache values hidden" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  local ts1="2026-05-21T10:00:00Z"
  local ts2="2026-05-21T10:18:00Z"
  # input=1.234M, output=567K → "1.2M/567K" must appear.
  # cache_creation=9.876M (→ "9.9M") and cache_read=8.765M (→ "8.8M")
  # are deliberately picked so any leakage into the row would be obvious.
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"LT","outcome":"ok","detail":""}
{"ts":"${ts1}","stage":"usage","label":"LT","outcome":"ok","detail":{"model":"claude-opus-4-7","input_tokens":1234000,"output_tokens":567000,"cache_creation_tokens":9876000,"cache_read_tokens":8765000,"cost_reported_usd":0,"duration_ms":1080000}}
{"ts":"${ts2}","stage":"pr","label":"LT","outcome":"ok","detail":"https://github.com/x/y/pull/12 US-VIEW-012"}
{"ts":"${ts2}","stage":"cycle_end","label":"LT","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  # input/output rendered together as in/out
  [[ "$output" == *"1.2M/567K"* ]]
  # cache fields must not surface anywhere in the dashboard
  [[ "$output" != *"9.9M"* ]]
  [[ "$output" != *"8.8M"* ]]
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
