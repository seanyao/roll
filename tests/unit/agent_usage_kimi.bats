#!/usr/bin/env bats
# Unit tests for lib/agent_usage/kimi.py (US-LOOP-030)
#
# Like openai and gemini, the Kimi CLI prints a token-usage summary to
# stdout, so kimi uses the standard extract() registry contract (stdout
# scraping).

LIB_DIR="${BATS_TEST_DIRNAME}/../../lib"
FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/kimi_output_sample.txt"

# Run kimi.extract() over the lines of a file and print the dict as JSON.
run_extract_file() {
  python3 -c "
import sys, json
sys.path.insert(0, '${LIB_DIR}')
from agent_usage.kimi import extract
with open('$1') as f:
    lines = f.readlines()
print(json.dumps(extract(lines)))
"
}

# Run kimi.extract() over inline lines (passed as a python list literal).
run_extract_lines() {
  python3 -c "
import sys, json
sys.path.insert(0, '${LIB_DIR}')
from agent_usage.kimi import extract
print(json.dumps(extract($1)))
"
}

# ─── Happy path: real kimi output fixture ─────────────────────────────────

@test "US-LOOP-030: kimi.extract() fixture yields all required fields non-null" {
  run run_extract_file "${FIXTURE}"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"model": "kimi-k2"'* ]]
  [[ "$output" == *'"input_tokens": 15300'* ]]
  [[ "$output" == *'"output_tokens": 3120'* ]]
  # cost_list_usd must be present and non-null (computed via model_prices)
  [[ "$output" == *'"cost_list_usd":'* ]]
  [[ "$output" != *'"cost_list_usd": null'* ]]
  [[ "$output" != *'"input_tokens": null'* ]]
  [[ "$output" != *'"output_tokens": null'* ]]
  [[ "$output" != *'"model": null'* ]]
}

# ─── Registry wiring ──────────────────────────────────────────────────────

@test "US-LOOP-030: registry has kimi entry and it is callable" {
  run python3 -c "
import sys; sys.path.insert(0, '${LIB_DIR}')
from agent_usage import REGISTRY
print('kimi' in REGISTRY and callable(REGISTRY.get('kimi')))
"
  [ "$status" -eq 0 ]
  [ "$output" = "True" ]
}

@test "US-LOOP-030: extract_usage('kimi', ...) validates and returns the dict" {
  run python3 -c "
import sys, os; sys.path.insert(0, '${LIB_DIR}')
sys.stderr = open(os.devnull, 'w')
from agent_usage import extract_usage
lines = ['Model: kimi-k2', 'Tokens: input=4000 output=1000']
r = extract_usage('kimi', lines)
print(r is not None and r['model'] == 'kimi-k2' and r['input_tokens'] == 4000 and r['output_tokens'] == 1000)
"
  [ "$status" -eq 0 ]
  [ "$output" = "True" ]
}

# ─── Model extraction ─────────────────────────────────────────────────────

@test "US-LOOP-030: kimi.extract() picks up the model name from output" {
  run run_extract_lines "['model: kimi-k2-turbo', 'input tokens: 100', 'output tokens: 50']"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"model": "kimi-k2-turbo"'* ]]
}

@test "US-LOOP-030: kimi.extract() tolerates thousands separators" {
  run run_extract_lines "['Input tokens: 1,234,567', 'Output tokens: 89,012']"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 1234567'* ]]
  [[ "$output" == *'"output_tokens": 89012'* ]]
}

# ─── No usage line → None (falls back to null payload) ────────────────────

@test "US-LOOP-030: kimi.extract() returns None when no usage line present" {
  run run_extract_lines "['just some chatter', 'no tokens here at all']"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}

@test "US-LOOP-030: kimi.extract() returns None for empty input" {
  run run_extract_lines "[]"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}

# ─── FIX-154: usage_from_session reads kimi-code wire.jsonl ───────────────
#
# kimi-code's `-p` (script/automation) mode prints nothing usage-related to
# stdout but persists every session to disk under
#   ~/.kimi-code/sessions/wd_<cwd-basename>_<8-hex>/session_<uuid>/agents/main/wire.jsonl
# usage_from_session sums the `usage.record` lines so the loop dashboard
# can show real tokens/cost for kimi cycles (FIX-154).

WIRE_FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/kimi_wire_sample.jsonl"

# Plant a wire.jsonl into a fake kimi-code sessions tree.
# $1 = wd_dir name (e.g. wd_roll-cycle-TESTCYCLE_deadbeef)
plant_wire() {
  local wd="$1"
  local dir="${TEST_TMP}/sessions/${wd}/session_abc/agents/main"
  mkdir -p "${dir}"
  cp "${WIRE_FIXTURE}" "${dir}/wire.jsonl"
}

setup_wire() {
  TEST_TMP="$(mktemp -d)"
}
teardown_wire() {
  rm -rf "${TEST_TMP:-}"
}

run_from_session() {
  ROLL_KIMI_SESSIONS_DIR="${TEST_TMP}/sessions" python3 -c "
import sys, json
sys.path.insert(0, '${LIB_DIR}')
from agent_usage.kimi import usage_from_session
print(json.dumps(usage_from_session($1)))
"
}

@test "FIX-154: kimi.usage_from_session sums usage.record tokens (match by cwd)" {
  setup_wire
  # Plant a session whose wd_ dir embeds the worktree basename.
  plant_wire "wd_roll-cycle-TESTCYCLE_deadbeef"
  run run_from_session "cwd='/sandbox/worktrees/roll-cycle-TESTCYCLE'"
  [ "$status" -eq 0 ]
  # 14850 + 2150 = 17000
  [[ "$output" == *'"input_tokens": 17000'* ]]
  # 217 + 83 = 300
  [[ "$output" == *'"output_tokens": 300'* ]]
  # 13056 + 4000 = 17056
  [[ "$output" == *'"cache_read_tokens": 17056'* ]]
  # 0 + 100 = 100
  [[ "$output" == *'"cache_creation_tokens": 100'* ]]
  [[ "$output" == *'"model": "kimi-code/kimi-for-coding"'* ]]
  teardown_wire
}

@test "FIX-154: kimi.usage_from_session matches by cycle_id when cwd not given" {
  setup_wire
  plant_wire "wd_anything-cycle-ABC123_cafebabe"
  run run_from_session "cycle_id='ABC123'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 17000'* ]]
  teardown_wire
}

@test "FIX-154: kimi.usage_from_session returns None when no session matches" {
  setup_wire
  plant_wire "wd_somethingelse_aaaaaaaa"
  run run_from_session "cwd='/no/such/worktree'"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
  teardown_wire
}

@test "FIX-154: kimi.usage_from_session returns None when sessions dir empty" {
  setup_wire
  run run_from_session "cwd='/sandbox/worktrees/anything'"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
  teardown_wire
}
