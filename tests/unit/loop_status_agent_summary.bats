#!/usr/bin/env bats
# US-AGENT-010: roll loop status / brief show per-agent hit rate summary.
#
# The summary line aggregates the last window_cycles records from
# runs.jsonl, grouping by agent. Each agent block shows `built/total
# (pct%)` or `(n/a)` when sample < 5.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"
RENDERER="${BATS_TEST_DIRNAME}/../../lib/roll-loop-status.py"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll runs
  export _SHARED_ROOT="$TEST_TMP/shared"
  mkdir -p "$_SHARED_ROOT/loop"
}

teardown() {
  cd /
  unset _SHARED_ROOT
  rm -rf "$TEST_TMP"
}

@test "agent_summary helper: returns no line when no records" {
  : > "$_SHARED_ROOT/loop/runs.jsonl"
  run python3 -c "
import sys, json, importlib.util
spec = importlib.util.spec_from_file_location('m', '$RENDERER')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._agent_summary_line([], window_cycles=50))
" 2>&1
  [ "$status" -eq 0 ]
  [ -z "$(echo "$output" | tr -d '\r')" ] || [[ "$output" == *"agents:"* ]]
}

@test "agent_summary helper: ≥5 samples shows built/total (pct%)" {
  run python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('m', '$RENDERER')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
# 10 pi cycles: 6 built, 4 idle → 60%
rs = []
for i in range(6): rs.append({'agent':'pi','status':'built'})
for i in range(4): rs.append({'agent':'pi','status':'idle'})
print(m._agent_summary_line(rs, window_cycles=50))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pi"* ]]
  [[ "$output" == *"6/10"* ]] || [[ "$output" == *"60%"* ]]
}

@test "agent_summary helper: <5 sample → (n/a)" {
  run python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('m', '$RENDERER')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rs = [{'agent':'pi','status':'built'} for _ in range(3)]
print(m._agent_summary_line(rs, window_cycles=50))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"n/a"* ]]
}

@test "agent_summary helper: multiple agents joined with ·" {
  run python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('m', '$RENDERER')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rs = []
for i in range(8): rs.append({'agent':'pi','status':'built' if i<3 else 'idle'})
for i in range(8): rs.append({'agent':'deepseek','status':'built' if i<6 else 'idle'})
print(m._agent_summary_line(rs, window_cycles=50))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pi"* ]]
  [[ "$output" == *"deepseek"* ]]
  [[ "$output" == *"·"* ]]
}

@test "agent_summary helper: ignores records without agent field" {
  run python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('m', '$RENDERER')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rs = [{'status':'built'}, {'status':'idle'}]  # no agent
print(m._agent_summary_line(rs, window_cycles=50))
"
  [ "$status" -eq 0 ]
  [[ -z "$(echo "$output" | tr -d '\r\n')" ]] || [[ "$output" == *"agents:"* ]] && [[ "$output" != *"pi"* ]]
}

@test "agent_summary helper: respects window_cycles cap" {
  run python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('m', '$RENDERER')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
# 20 deepseek records, but window=5 → only last 5 considered
rs = [{'agent':'deepseek','status':'built'} for _ in range(20)]
# All last-5 are built → 5/5 = 100%
print(m._agent_summary_line(rs, window_cycles=5))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"5/5"* ]] || [[ "$output" == *"100%"* ]]
}
