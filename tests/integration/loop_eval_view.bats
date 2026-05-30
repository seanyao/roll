#!/usr/bin/env bats
# US-EVAL-003: `roll loop eval [N]` result-eval trend view (window aggregation)
# and the dashboard result-eval summary line. Drives the real
# lib/roll-loop-status.py over a synthetic runs.jsonl carrying result_eval
# blocks (written by US-EVAL-002) and asserts the aggregated output.

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

# Write a runs.jsonl with `count` scored records (+ optionally one old-schema
# record with no result_eval). Project basename is matched leniently by
# load_runs, so we stamp `project` with the project slug.
write_runs() {
  local slug="$1"; shift
  local runs="${ROLL_SHARED_ROOT}/loop/runs.jsonl"
  : > "$runs"
  # Three ascending scores: 4, 6, 9 → mean 6.3, min 4, trend up.
  cat >> "$runs" <<EOF
{"run_id":"r1","ts":"2026-05-01T01:00:00Z","project":"${slug}","result_eval":{"version":1,"score":4,"dims":{"outcome":0.0,"correctness":"unknown","scope_fidelity":1.0,"quality":1.0,"efficiency":1.0,"cleanliness":1.0}}}
{"run_id":"r2","ts":"2026-05-02T01:00:00Z","project":"${slug}","result_eval":{"version":1,"score":6,"dims":{"outcome":1.0,"correctness":1.0,"scope_fidelity":1.0,"quality":0.5,"efficiency":1.0,"cleanliness":1.0}}}
{"run_id":"r3","ts":"2026-05-03T01:00:00Z","project":"${slug}","result_eval":{"version":1,"score":9,"dims":{"outcome":1.0,"correctness":1.0,"scope_fidelity":1.0,"quality":1.0,"efficiency":1.0,"cleanliness":1.0}}}
{"run_id":"r4","ts":"2026-05-04T01:00:00Z","project":"${slug}"}
EOF
}

@test "US-EVAL-003: roll loop eval prints mean/min/trend + per-dim hit-rate" {
  local slug; slug=$(slug_for_cwd)
  write_runs "$slug"
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --eval
  [ "$status" -eq 0 ]
  # mean of 4,6,9 = 6.3 (old-schema r4 skipped, not counted)
  [[ "$output" == *"mean   6.3 / 10"* ]]
  [[ "$output" == *"min    4 / 10"* ]]
  [[ "$output" == *"n      3"* ]]
  # ascending scores → upward trend arrow
  [[ "$output" == *"↑"* ]]
  # per-dimension hit-rate block present
  [[ "$output" == *"dimension hit-rate"* ]]
  # outcome hit 2/3 = 67%; correctness 2/2 known = 100% (the unknown excluded)
  [[ "$output" == *"outcome          67%"* ]]
  [[ "$output" == *"correctness      100%"* ]]
}

@test "US-EVAL-003: roll loop eval N respects the window size" {
  local slug; slug=$(slug_for_cwd)
  write_runs "$slug"
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --eval 5
  [ "$status" -eq 0 ]
  [[ "$output" == *"last 5 cycles"* ]]
}

@test "US-EVAL-003: <3 scored cycles → (n/a) need 3 notice" {
  local slug; slug=$(slug_for_cwd)
  local runs="${ROLL_SHARED_ROOT}/loop/runs.jsonl"
  cat > "$runs" <<EOF
{"run_id":"r1","ts":"2026-05-01T01:00:00Z","project":"${slug}","result_eval":{"version":1,"score":7,"dims":{"outcome":1.0}}}
{"run_id":"r2","ts":"2026-05-02T01:00:00Z","project":"${slug}","result_eval":{"version":1,"score":8,"dims":{"outcome":1.0}}}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --eval
  [ "$status" -eq 0 ]
  [[ "$output" == *"(n/a)"* ]]
  [[ "$output" == *"need 3"* ]]
}

@test "US-EVAL-003: no result_eval anywhere → no error, 'no scored cycles' notice" {
  local slug; slug=$(slug_for_cwd)
  local runs="${ROLL_SHARED_ROOT}/loop/runs.jsonl"
  # Only an old-schema record — backward compat: must not error.
  cat > "$runs" <<EOF
{"run_id":"r1","ts":"2026-05-01T01:00:00Z","project":"${slug}"}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --eval
  [ "$status" -eq 0 ]
  [[ "$output" == *"no scored cycles"* ]]
}

@test "US-EVAL-003: dashboard renders a distinct result-eval trend line" {
  local slug; slug=$(slug_for_cwd)
  write_runs "$slug"
  # Need a cycle in the events stream so the dashboard renders the summary block.
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  cat > "$evfile" <<EOF
{"ts":"2026-05-03T10:00:00Z","stage":"cycle_start","label":"LT","outcome":"ok","detail":""}
{"ts":"2026-05-03T10:18:00Z","stage":"cycle_end","label":"LT","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 90
  [ "$status" -eq 0 ]
  # The result-eval line is distinct from the self-score line.
  [[ "$output" == *"result-eval:"* ]]
  [[ "$output" == *"mean 6.3"* ]]
}
