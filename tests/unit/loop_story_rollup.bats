#!/usr/bin/env bats
# US-LOOP-024: rollup_for_story aggregates per-story cycles.
#
# Pure-function tests over a synthetic cycles list (the shape produced by
# aggregate() + merge_runs_into_cycles() + backfill_usage_from_claude_sessions()).
# No filesystem I/O — feeds cycles directly into rollup_for_story().

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

# Run rollup_for_story(cycles_json, story_id) and emit the result as JSON.
# cycles_json is fed via stdin so bats quoting stays sane.
rollup() {
  local story_id="$1"
  python3 -c "
import sys, json, importlib.util
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cycles = json.load(sys.stdin)
# Revive ISO datetimes (start/end) so the function sees real datetime objects.
for cy in cycles:
    for k in ('start', 'end'):
        if isinstance(cy.get(k), str):
            cy[k] = datetime.fromisoformat(cy[k])
out = m.rollup_for_story(cycles, sys.argv[1])
# Strip cycle datetimes/list before dumping (we only inspect aggregates here).
out = {k: v for k, v in out.items() if k != 'cycles'}
for k in ('span_start', 'span_end'):
    if out.get(k) is not None:
        out[k] = out[k].isoformat()
print(json.dumps(out))
" "$story_id"
}

setup() {
  CYCLES_JSON=$(cat <<'EOF'
[
  {"label": "20260518-142233-91", "story": "US-LOOP-004", "outcome": "done",
   "start": "2026-05-18T14:22:33+08:00", "end": "2026-05-18T14:55:00+08:00",
   "duration_s": 1947, "input_tokens": 120000, "output_tokens": 5500,
   "cache_creation_tokens": 400000, "cache_read_tokens": 2600000,
   "cost_list": 2.10, "model": "claude-opus-4-7",
   "pr_num": 128, "pr_outcome": "merged"},
  {"label": "20260518-203045-12", "story": "US-LOOP-004", "outcome": "fail",
   "start": "2026-05-18T20:30:45+08:00", "end": "2026-05-18T21:18:00+08:00",
   "duration_s": 2835, "input_tokens": 180000, "output_tokens": 7800,
   "cache_creation_tokens": 500000, "cache_read_tokens": 3100000,
   "cost_list": 1.71, "model": "claude-opus-4-7",
   "pr_num": 131, "pr_outcome": "closed"},
  {"label": "20260519-091112-44", "story": "US-LOOP-004", "outcome": "done",
   "start": "2026-05-19T09:11:12+08:00", "end": "2026-05-19T09:31:00+08:00",
   "duration_s": 1188, "input_tokens": 112000, "output_tokens": 5000,
   "cache_creation_tokens": 300000, "cache_read_tokens": 2100000,
   "cost_list": 1.11, "model": "claude-opus-4-7",
   "pr_num": 134, "pr_outcome": "merged"},
  {"label": "20260520-103022-77", "story": "US-LOOP-007", "outcome": "done",
   "start": "2026-05-20T10:30:22+08:00", "end": "2026-05-20T10:45:00+08:00",
   "duration_s": 878, "input_tokens": 50000, "output_tokens": 2200,
   "cost_list": 0.55, "model": "claude-opus-4-7",
   "pr_num": 140, "pr_outcome": "merged"}
]
EOF
)
}

@test "rollup_for_story counts 3 matching cycles" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  count=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
  [ "$count" -eq 3 ]
}

@test "rollup_for_story splits outcomes ✓2 ✗1 ⏵0" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  ok=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['ok_count'])")
  fail=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['fail_count'])")
  running=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['running_count'])")
  [ "$ok" -eq 2 ]
  [ "$fail" -eq 1 ]
  [ "$running" -eq 0 ]
}

@test "rollup_for_story sums duration_s across cycles" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  dur=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['duration_s'])")
  [ "$dur" -eq 5970 ]
}

@test "rollup_for_story sums input + output tokens" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  in_t=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['input_tokens'])")
  out_t=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['output_tokens'])")
  [ "$in_t" -eq 412000 ]
  [ "$out_t" -eq 18300 ]
}

@test "rollup_for_story sums cost_list to 4.92" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  cost=$(echo "$result" | python3 -c "import sys,json; print(f\"{json.load(sys.stdin)['cost']:.2f}\")")
  [ "$cost" = "4.92" ]
}

@test "rollup_for_story span covers earliest start → latest end" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  start=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['span_start'])")
  end=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['span_end'])")
  [[ "$start" == 2026-05-18T14:22:33* ]]
  [[ "$end"   == 2026-05-19T09:31:00* ]]
}

@test "rollup_for_story collects PRs with outcomes" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  prs=$(echo "$result" | python3 -c "
import sys, json
prs = json.load(sys.stdin)['prs']
print(','.join(f\"{p['num']}:{p['outcome']}\" for p in prs))
")
  [[ "$prs" == *"128:merged"* ]]
  [[ "$prs" == *"131:closed"* ]]
  [[ "$prs" == *"134:merged"* ]]
}

@test "rollup_for_story is case-insensitive (us-loop-004 matches US-LOOP-004)" {
  result=$(echo "$CYCLES_JSON" | rollup "us-loop-004")
  count=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
  [ "$count" -eq 3 ]
}

@test "rollup_for_story returns count=0 for unknown story" {
  result=$(echo "$CYCLES_JSON" | rollup "US-NOPE-999")
  count=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
  cost=$(echo "$result" | python3 -c "import sys,json; print(f\"{json.load(sys.stdin)['cost']:.2f}\")")
  [ "$count" -eq 0 ]
  [ "$cost" = "0.00" ]
}

@test "rollup_for_story does not bleed cycles from other stories into totals" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-007")
  count=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
  cost=$(echo "$result" | python3 -c "import sys,json; print(f\"{json.load(sys.stdin)['cost']:.2f}\")")
  [ "$count" -eq 1 ]
  [ "$cost" = "0.55" ]
}

@test "rollup_for_story captures model from first matching cycle" {
  result=$(echo "$CYCLES_JSON" | rollup "US-LOOP-004")
  model=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['model'])")
  [ "$model" = "claude-opus-4-7" ]
}

@test "rollup_for_story counts a running cycle as running, not ok" {
  cycles=$(cat <<'EOF'
[
  {"label": "20260520-150000-11", "story": "US-LOOP-099", "outcome": "running",
   "start": "2026-05-20T15:00:00+08:00", "duration_s": 0}
]
EOF
)
  result=$(echo "$cycles" | rollup "US-LOOP-099")
  ok=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['ok_count'])")
  running=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['running_count'])")
  [ "$ok" -eq 0 ]
  [ "$running" -eq 1 ]
}
