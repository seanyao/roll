#!/usr/bin/env bats
# Unit tests for lib/agent_usage/qwen.py (US-LOOP-031)
#
# Like openai, gemini and kimi, the Qwen / dashscope CLI prints a token-usage
# summary to stdout, so qwen uses the standard extract() registry contract
# (stdout scraping).

LIB_DIR="${BATS_TEST_DIRNAME}/../../lib"
FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/qwen_output_sample.txt"

# Run qwen.extract() over the lines of a file and print the dict as JSON.
run_extract_file() {
  python3 -c "
import sys, json
sys.path.insert(0, '${LIB_DIR}')
from agent_usage.qwen import extract
with open('$1') as f:
    lines = f.readlines()
print(json.dumps(extract(lines)))
"
}

# Run qwen.extract() over inline lines (passed as a python list literal).
run_extract_lines() {
  python3 -c "
import sys, json
sys.path.insert(0, '${LIB_DIR}')
from agent_usage.qwen import extract
print(json.dumps(extract($1)))
"
}

# ─── Happy path: real qwen output fixture ─────────────────────────────────

@test "US-LOOP-031: qwen.extract() fixture yields all required fields non-null" {
  run run_extract_file "${FIXTURE}"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"model": "qwen-coder-plus"'* ]]
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

@test "US-LOOP-031: registry has qwen entry and it is callable" {
  run python3 -c "
import sys; sys.path.insert(0, '${LIB_DIR}')
from agent_usage import REGISTRY
print('qwen' in REGISTRY and callable(REGISTRY.get('qwen')))
"
  [ "$status" -eq 0 ]
  [ "$output" = "True" ]
}

@test "US-LOOP-031: extract_usage('qwen', ...) validates and returns the dict" {
  run python3 -c "
import sys, os; sys.path.insert(0, '${LIB_DIR}')
sys.stderr = open(os.devnull, 'w')
from agent_usage import extract_usage
lines = ['Model: qwen-max', 'Tokens: input=4000 output=1000']
r = extract_usage('qwen', lines)
print(r is not None and r['model'] == 'qwen-max' and r['input_tokens'] == 4000 and r['output_tokens'] == 1000)
"
  [ "$status" -eq 0 ]
  [ "$output" = "True" ]
}

# ─── Model extraction ─────────────────────────────────────────────────────

@test "US-LOOP-031: qwen.extract() picks up the model name from output" {
  run run_extract_lines "['model: qwen-max', 'input tokens: 100', 'output tokens: 50']"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"model": "qwen-max"'* ]]
}

@test "US-LOOP-031: qwen.extract() tolerates thousands separators" {
  run run_extract_lines "['Input tokens: 1,234,567', 'Output tokens: 89,012']"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 1234567'* ]]
  [[ "$output" == *'"output_tokens": 89012'* ]]
}

# ─── No usage line → None (falls back to null payload) ────────────────────

@test "US-LOOP-031: qwen.extract() returns None when no usage line present" {
  run run_extract_lines "['just some chatter', 'no tokens here at all']"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}

@test "US-LOOP-031: qwen.extract() returns None for empty input" {
  run run_extract_lines "[]"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}
