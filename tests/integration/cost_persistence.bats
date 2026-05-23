#!/usr/bin/env bats
# US-VIEW-014: dashboard renders each cycle's cost using the value frozen at
# cycle_end, so a later prices refresh never mutates historical numbers.
#
# The integration angle: two cycles in events.ndjson, each persisted with a
# different cost_list_usd / prices_version. The dashboard must surface both
# costs as-written, not recomputed against the currently-active snapshot.

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

@test "E2E: two cycles with different frozen costs render their persisted values" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  # Cycle A: prices_version=2026-04-01 frozen at $7.77 (deliberately not the
  # list-price math result so a recompute would be visibly different).
  # Cycle B: prices_version=2026-05-22 frozen at $3.33 with identical token
  # counts to A — proves recompute can't unify them; persistence wins.
  local ts_a1="2026-05-19T22:37:00Z"
  local ts_a2="2026-05-19T22:55:00Z"
  local ts_b1="2026-05-21T10:00:00Z"
  local ts_b2="2026-05-21T10:18:00Z"
  cat > "$evfile" <<EOF
{"ts":"${ts_a1}","stage":"cycle_start","label":"LA","outcome":"ok","detail":""}
{"ts":"${ts_a1}","stage":"usage","label":"LA","outcome":"ok","detail":{"model":"claude-opus-4-7","input_tokens":1000000,"output_tokens":1000000,"cache_creation_tokens":0,"cache_read_tokens":0,"cost_reported_usd":12.34,"duration_ms":1080000,"cost_list_usd":7.77,"prices_version":"2026-04-01"}}
{"ts":"${ts_a2}","stage":"cycle_end","label":"LA","outcome":"done","detail":""}
{"ts":"${ts_b1}","stage":"cycle_start","label":"LB","outcome":"ok","detail":""}
{"ts":"${ts_b1}","stage":"usage","label":"LB","outcome":"ok","detail":{"model":"claude-opus-4-7","input_tokens":1000000,"output_tokens":1000000,"cache_creation_tokens":0,"cache_read_tokens":0,"cost_reported_usd":11.11,"duration_ms":1080000,"cost_list_usd":3.33,"prices_version":"2026-05-22"}}
{"ts":"${ts_b2}","stage":"cycle_end","label":"LB","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  # Both frozen costs surface verbatim. The live snapshot would compute $30.00
  # (1M*5 + 1M*25 = $30 for opus-4-7 in the 2026-05-22 snapshot); seeing $7.77
  # and $3.33 instead proves the persisted values are preferred.
  [[ "$output" == *'$7.77'* ]]
  [[ "$output" == *'$3.33'* ]]
  # The non-persisted "live" price ($30.00) must not appear for either cycle.
  [[ "$output" != *'$30.00'* ]]
  # Persisted values are authoritative — no [legacy] tag on these rows.
  [[ "$output" != *'[legacy]'* ]]
}

@test "E2E: legacy event without cost_list_usd renders recomputed value tagged [legacy]" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  # Pre-US-VIEW-014 shape: no cost_list_usd field. Dashboard must fall back
  # to recomputing via compute_list_cost and mark the row [legacy].
  local ts1="2026-05-19T22:37:00Z"
  local ts2="2026-05-19T22:55:00Z"
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"LO","outcome":"ok","detail":""}
{"ts":"${ts1}","stage":"usage","label":"LO","outcome":"ok","detail":{"model":"claude-opus-4-7","input_tokens":1000000,"output_tokens":1000000,"cache_creation_tokens":0,"cache_read_tokens":0,"cost_reported_usd":12.34,"duration_ms":1080000}}
{"ts":"${ts2}","stage":"cycle_end","label":"LO","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  # Recomputed list-price for opus-4-7 with 1M+1M tokens = $30.00.
  [[ "$output" == *'$30.00'* ]]
  # And the [legacy] tag is visible on the row so the value can't be mistaken
  # for an authoritative frozen number.
  [[ "$output" == *'[legacy]'* ]]
}
