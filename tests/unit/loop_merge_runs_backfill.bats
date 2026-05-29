#!/usr/bin/env bats
# FIX-144: merge_runs_into_cycles must backfill idle/failed outcomes from
# runs.jsonl when runs says 'built' but events stream says 'idle' or 'failed'.
# This happens when _loop_event cycle_end emits 'failed' (e.g. PR publish
# failure) but _runs_append records 'built' because the agent did commit.

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

# Helper: call merge_runs_into_cycles(cycles_json, runs_json) and print
# the resulting cycles as JSON (outcome + label only, for easy assertions).
merge_runs() {
  local runs_json="$1"
  python3 -c "
import sys, json, importlib.util
from datetime import datetime, timezone, timedelta
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cycles = json.load(sys.stdin)
for cy in cycles:
    for k in ('start', 'end'):
        if isinstance(cy.get(k), str):
            cy[k] = datetime.fromisoformat(cy[k])
runs = json.loads('''${runs_json}''')
for rid, r in runs.items():
    if isinstance(r.get('ts'), str):
        r['ts'] = r['ts'].replace('Z', '+00:00')
m.merge_runs_into_cycles(cycles, runs)
print(json.dumps([{'label': c['label'], 'outcome': c.get('outcome')} for c in cycles]))
"
}

@test "FIX-144: events idle + runs built → backfilled to done" {
  local cycles='[{"label":"cy-idle","start":"2026-05-29T10:00:00+00:00","end":"2026-05-29T10:30:00+00:00","outcome":"idle"}]'
  local runs='{"loop-1":{"ts":"2026-05-29T10:05:00+00:00","status":"built","built":["US-X-001"]}}'
  run merge_runs "$runs" <<< "$cycles"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome": "done"'* ]]
}

@test "FIX-144: events failed + runs built → backfilled to done" {
  local cycles='[{"label":"cy-failed","start":"2026-05-29T11:00:00+00:00","end":"2026-05-29T11:30:00+00:00","outcome":"failed"}]'
  local runs='{"loop-2":{"ts":"2026-05-29T11:05:00+00:00","status":"built","built":["FIX-144"]}}'
  run merge_runs "$runs" <<< "$cycles"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome": "done"'* ]]
}

@test "FIX-144: events unknown + runs built → backfilled to done (regression)" {
  local cycles='[{"label":"cy-unknown","start":"2026-05-29T12:00:00+00:00","end":"2026-05-29T12:30:00+00:00","outcome":"unknown"}]'
  local runs='{"loop-3":{"ts":"2026-05-29T12:05:00+00:00","status":"built","built":["US-Y-002"]}}'
  run merge_runs "$runs" <<< "$cycles"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome": "done"'* ]]
}

@test "FIX-144: events done + runs interrupted → stays done (do not override)" {
  local cycles='[{"label":"cy-done","start":"2026-05-29T13:00:00+00:00","end":"2026-05-29T13:30:00+00:00","outcome":"done"}]'
  local runs='{"loop-4":{"ts":"2026-05-29T13:05:00+00:00","status":"interrupted","built":[]}}'
  run merge_runs "$runs" <<< "$cycles"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome": "done"'* ]]
}

@test "FIX-144: events failed + runs interrupted → overridden to fail" {
  local cycles='[{"label":"cy-fail","start":"2026-05-29T14:00:00+00:00","end":"2026-05-29T14:30:00+00:00","outcome":"failed"}]'
  local runs='{"loop-5":{"ts":"2026-05-29T14:05:00+00:00","status":"interrupted","built":[]}}'
  run merge_runs "$runs" <<< "$cycles"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome": "fail"'* ]]
}

@test "FIX-144: events idle + runs interrupted → overridden to fail" {
  local cycles='[{"label":"cy-idle2","start":"2026-05-29T15:00:00+00:00","end":"2026-05-29T15:30:00+00:00","outcome":"idle"}]'
  local runs='{"loop-6":{"ts":"2026-05-29T15:05:00+00:00","status":"interrupted","built":[]}}'
  run merge_runs "$runs" <<< "$cycles"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome": "fail"'* ]]
}
