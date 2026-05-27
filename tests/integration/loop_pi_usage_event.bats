#!/usr/bin/env bats
# Integration test: pi passthrough → plugin extraction → real usage event (US-LOOP-026)

LOOP_FMT="${BATS_TEST_DIRNAME}/../../lib/loop-fmt.py"
FIXTURE="${BATS_TEST_DIRNAME}/../../tests/fixtures/pi_output_sample.txt"

setup() {
  TEST_TMP="$(mktemp -d)"
  export LOOP_PROJECT_SLUG="test-slug"
  export LOOP_CYCLE_ID="test-cycle-int-001"
  export LOOP_SHARED_ROOT="$TEST_TMP"
  mkdir -p "$TEST_TMP/loop"
  export ROLL_LOOP_AGENT="pi"
  export PYTHONPATH="${BATS_TEST_DIRNAME}/../../lib:$PYTHONPATH"
}
teardown() {
  unset PYTHONPATH
  rm -rf "${TEST_TMP:-}"
}

# ─── Full passthrough → plugin extraction ─────────────────────────────────

@test "US-LOOP-026: pi passthrough with kv-block fixture emits real usage event" {
  run python3 "$LOOP_FMT" < "$FIXTURE"
  [ "$status" -eq 0 ]

  local evfile="$TEST_TMP/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]

  # Should contain our cycle id
  grep -q 'test-cycle-int-001' "$evfile"

  # Should contain real token numbers (not null)
  run grep -c 'null' "$evfile"
  # null may appear in duration_ms, but input_tokens/output_tokens/cost should not be null
  run python3 -c "
import json
with open('$evfile') as f:
    for line in f:
        ev = json.loads(line)
        detail = ev.get('detail', {})
        if detail.get('model') == 'deepseek-v4-pro':
            assert detail['input_tokens'] is not None, 'input_tokens is null'
            assert detail['output_tokens'] is not None, 'output_tokens is null'
            assert detail['cost_list_usd'] is not None, 'cost_list_usd is null'
            print('OK: real usage event found')
            break
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK: real usage event found"* ]]
}

@test "US-LOOP-026: pi passthrough with unrecognized output falls back to null" {
  # Create input that won't match any plugin pattern
  local tmp_in="$TEST_TMP/unrecognized.txt"
  printf 'Just some random text\nNo token info here\n' > "$tmp_in"

  run python3 "$LOOP_FMT" < "$tmp_in"
  [ "$status" -eq 0 ]

  local evfile="$TEST_TMP/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]

  # The event should exist but with null model "pi" (fallback)
  run python3 -c "
import json
with open('$evfile') as f:
    for line in f:
        ev = json.loads(line)
        detail = ev.get('detail', {})
        # model should be the agent name 'pi'
        assert detail.get('model') == 'pi', f'unexpected model: {detail.get(\"model\")}'
        # tokens should be null (fallback)
        assert detail.get('input_tokens') is None, 'expected null input_tokens'
        assert detail.get('output_tokens') is None, 'expected null output_tokens'
        print('OK: null fallback event found')
        break
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK: null fallback event found"* ]]
}

@test "US-LOOP-026: pi passthrough writes exactly one usage event" {
  run python3 "$LOOP_FMT" < "$FIXTURE"
  [ "$status" -eq 0 ]

  local evfile="$TEST_TMP/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]

  # Count usage events in ndjson
  local count
  count=$(python3 -c "
import json
count = 0
with open('$evfile') as f:
    for line in f:
        ev = json.loads(line)
        if ev.get('stage') == 'usage':
            count += 1
print(count)
")
  [ "$count" -eq 1 ]
}

@test "US-LOOP-026: unregistered agent (kimi) writes null fallback event" {
  export ROLL_LOOP_AGENT="kimi"
  printf 'Some output from kimi\n' | python3 "$LOOP_FMT"

  local evfile="$TEST_TMP/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]

  run python3 -c "
import json
with open('$evfile') as f:
    for line in f:
        ev = json.loads(line)
        detail = ev.get('detail', {})
        assert detail.get('model') == 'kimi'
        assert detail.get('input_tokens') is None
        assert detail.get('output_tokens') is None
        print('OK: kimi null fallback')
        break
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK: kimi null fallback"* ]]
}
