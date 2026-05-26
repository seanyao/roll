#!/usr/bin/env bats
# Unit tests for lib/agent_usage/pi.py (US-LOOP-026)

PI_PLUGIN="${BATS_TEST_DIRNAME}/../../lib/agent_usage/pi.py"

setup() {
  TEST_TMP="$(mktemp -d)"
}
teardown() {
  rm -rf "${TEST_TMP:-}"
}

run_extract() {
  # Pass lines via stdin as JSON array to the python extract function
  local input_file="$1"
  python3 -c "
import sys, json
sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage.pi import extract
lines = open('${input_file}').read().splitlines()
result = extract(lines)
print(json.dumps(result))
"
}

# ─── Happy path: key-value block ──────────────────────────────────────────

@test "US-LOOP-026: pi.extract() parses key-value block style" {
  local fixture="${BATS_TEST_DIRNAME}/../../tests/fixtures/pi_output_sample.txt"
  run run_extract "$fixture"
  [ "$status" -eq 0 ]
  local output="$output"
  # Should contain all required fields
  [[ "$output" == *'"input_tokens": 15234'* ]]
  [[ "$output" == *'"output_tokens": 3456'* ]]
  [[ "$output" == *'"cost_list_usd": 0.1234'* ]]
  [[ "$output" == *'"model": "deepseek-v4-pro"'* ]]
}

@test "US-LOOP-026: pi.extract() returns non-null required fields" {
  local fixture="${BATS_TEST_DIRNAME}/../../tests/fixtures/pi_output_sample.txt"
  run run_extract "$fixture"
  [ "$status" -eq 0 ]
  # Verify required fields (input_tokens, output_tokens, cost_list_usd, model)
  # are not null.  duration_ms may be None — that's expected.
  [[ "$output" != *'"input_tokens": null'* ]]
  [[ "$output" != *'"output_tokens": null'* ]]
  [[ "$output" != *'"cost_list_usd": null'* ]]
  [[ "$output" != *'"model": null'* ]]
}

# ─── Edge cases ───────────────────────────────────────────────────────────

@test "US-LOOP-026: pi.extract() returns None for empty input" {
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage.pi import extract
result = extract([])
print(result)
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}

@test "US-LOOP-026: pi.extract() returns None for unrecognized format" {
  local tmp="$TEST_TMP/unrecognized.txt"
  printf 'just some random text\nno tokens here\n' > "$tmp"
  run run_extract "$tmp"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}

@test "US-LOOP-026: pi.extract() handles missing cost gracefully" {
  local tmp="$TEST_TMP/no_cost.txt"
  printf 'Input: 1000\nOutput: 500\n' > "$tmp"
  run run_extract "$tmp"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 1000'* ]]
  [[ "$output" == *'"output_tokens": 500'* ]]
  # cost_list_usd should default to 0.0, not None
  [[ "$output" == *'"cost_list_usd": 0.0'* ]]
}

@test "US-LOOP-026: pi.extract() only looks at last 50 lines" {
  local tmp="$TEST_TMP/long_output.txt"
  # Generate 100 lines of noise, then the summary
  for i in $(seq 1 100); do echo "noise line $i"; done >> "$tmp"
  printf 'Input: 5000\nOutput: 2000\nCost: 0.05\n' >> "$tmp"
  run run_extract "$tmp"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 5000'* ]]
}

# ─── Footer-inline pattern ────────────────────────────────────────────────

@test "US-LOOP-026: pi.extract() parses footer-style inline" {
  local tmp="$TEST_TMP/footer.txt"
  printf 'Some output here\n↑12.3k ↓5.1k R2.0k W1.5k $0.234\n' > "$tmp"
  run run_extract "$tmp"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 12300'* ]]
  [[ "$output" == *'"output_tokens": 5100'* ]]
  [[ "$output" == *'"cost_list_usd": 0.234'* ]]
}

@test "US-LOOP-026: pi.extract() parses simple inline (↑↓ without cache)" {
  local tmp="$TEST_TMP/simple.txt"
  printf 'Done.\n↑800 ↓300 $0.015\n' > "$tmp"
  run run_extract "$tmp"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 800'* ]]
  [[ "$output" == *'"output_tokens": 300'* ]]
}

# ─── JSON summary pattern ─────────────────────────────────────────────────

@test "US-LOOP-026: pi.extract() parses JSON summary style" {
  local tmp="$TEST_TMP/json_summary.txt"
  printf '{"session": "abc", "input_tokens": 10000, "output_tokens": 2500, "cost_list_usd": 0.15, "model": "deepseek-v4-pro"}\n' > "$tmp"
  run run_extract "$tmp"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 10000'* ]]
  [[ "$output" == *'"output_tokens": 2500'* ]]
  [[ "$output" == *'"cost_list_usd": 0.15'* ]]
}
