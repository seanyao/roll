#!/usr/bin/env bats
# E2E for US-VIEW-010 golden path: dashboard renders a cycle row with model
# label and list-price cost computed from cumulative tokens in events.ndjson.

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

@test "E2E: cycle row shows opus-4-7 label and list-price cost from cumulative tokens" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  # Cycle with 1M input + 1M output on opus → list price = 15 + 75 = $90.00
  local ts1="2026-05-19T22:37:00Z"
  local ts2="2026-05-19T22:55:00Z"
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"L99","outcome":"ok","detail":""}
{"ts":"${ts1}","stage":"usage","label":"L99","outcome":"ok","detail":{"model":"claude-opus-4-7","input_tokens":1000000,"output_tokens":1000000,"cache_creation_tokens":0,"cache_read_tokens":0,"cost_reported_usd":12.34,"duration_ms":1080000}}
{"ts":"${ts2}","stage":"pr","label":"L99","outcome":"ok","detail":"https://github.com/x/y/pull/99 US-VIEW-010"}
{"ts":"${ts2}","stage":"cycle_end","label":"L99","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  # opus-4-7 model label appears in a cycle row
  [[ "$output" == *"opus-4-7"* ]]
  # list-price cost ($90.00) appears, not the client-reported $12.34
  [[ "$output" == *'$90.00'* ]]
  [[ "$output" != *'$12.34'* ]]
}
