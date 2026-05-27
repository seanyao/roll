#!/usr/bin/env bats
# Unit tests for lib/agent_usage/__init__.py registry (US-LOOP-026)

setup() {
  TEST_TMP="$(mktemp -d)"
}
teardown() {
  rm -rf "${TEST_TMP:-}"
}

# ─── Registry lookup ──────────────────────────────────────────────────────

@test "US-LOOP-026: registry has pi entry" {
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import REGISTRY
print('pi' in REGISTRY)
"
  [ "$status" -eq 0 ]
  [ "$output" = "True" ]
}

@test "US-LOOP-026: pi plugin is callable" {
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import REGISTRY
fn = REGISTRY.get('pi')
print(callable(fn))
"
  [ "$status" -eq 0 ]
  [ "$output" = "True" ]
}

@test "US-LOOP-026: extract_usage with pi returns None (text mode has no usage)" {
  # pi runs as `pi -p` text mode — stdout is only the answer, no token/cost
  # summary. So the stdout-scraping registry path always yields None; real
  # usage is recovered out-of-band from session files (usage_from_session).
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import extract_usage
lines = [
    'some output',
    'Input: 15000',
    'Output: 3000',
    'Cost: 0.15',
]
result = extract_usage('pi', lines)
print(result)
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}

# ─── Unregistered agent → None ───────────────────────────────────────────

@test "US-LOOP-026: extract_usage returns None for unregistered agent" {
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import extract_usage
result = extract_usage('unregistered_agent', ['line'])
print(result)
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}

@test "US-LOOP-026: extract_usage returns None for empty lines" {
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import extract_usage
result = extract_usage('pi', [])
print(result)
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}

# ─── Plugin exception → None (no crash) ───────────────────────────────────

@test "US-LOOP-026: extract_usage swallows plugin exceptions gracefully" {
  # Temporarily replace pi plugin function with one that always raises
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import REGISTRY, extract_usage

# Monkey-patch: replace pi entry with a function that raises
def bad_extract(lines):
    raise RuntimeError('simulated plugin crash')
REGISTRY['pi'] = bad_extract

result = extract_usage('pi', ['line'])
print(result)
" 2>/dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *None ]]
}

# ─── Plugin returning None → None ─────────────────────────────────────────

@test "US-LOOP-026: extract_usage returns None when plugin returns None" {
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import REGISTRY, extract_usage

def none_extract(lines):
    return None
REGISTRY['pi'] = none_extract

result = extract_usage('pi', ['unrecognizable'])
print(result)
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}

# ─── Plugin returning missing required field → None ───────────────────────

@test "US-LOOP-026: extract_usage returns None when plugin omits input_tokens" {
  run python3 -c "
import sys; sys.path.insert(0, '${BATS_TEST_DIRNAME}/../../lib')
from agent_usage import REGISTRY, extract_usage

def partial_extract(lines):
    return {'model': 'test', 'input_tokens': None, 'output_tokens': 100, 'cost_list_usd': 0.1}
REGISTRY['pi'] = partial_extract

result = extract_usage('pi', ['line'])
print(result)
" 2>/dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *None ]]
}
