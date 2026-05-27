#!/usr/bin/env bats
# Integration: pi usage capture (US-LOOP-026)
#
# New architecture:
#   - loop-fmt passthrough is DISPLAY-ONLY (no usage event; pi -p text mode
#     carries no usage, and it ran once per retry → ×N inflation).
#   - agent_usage/pi_emit.py writes exactly ONE authoritative usage event per
#     cycle, recovered from pi's session jsonl, with cost frozen in CNY.

LOOP_FMT="${BATS_TEST_DIRNAME}/../../lib/loop-fmt.py"
PI_EMIT="${BATS_TEST_DIRNAME}/../../lib/agent_usage/pi_emit.py"
SESSION_FIXTURE="${BATS_TEST_DIRNAME}/../../tests/fixtures/pi_session_sample.jsonl"
WT_CWD="/sandbox/worktrees/roll-cycle-TESTCYCLE"

setup() {
  TEST_TMP="$(mktemp -d)"
  export LOOP_PROJECT_SLUG="test-slug"
  export LOOP_CYCLE_ID="test-cycle-int-001"
  export LOOP_SHARED_ROOT="$TEST_TMP"
  mkdir -p "$TEST_TMP/loop"
  export PYTHONPATH="${BATS_TEST_DIRNAME}/../../lib:$PYTHONPATH"
  # pi sessions root scanned as <base>/*/*.jsonl
  SESS_DIR="$TEST_TMP/sessions/encoded"
  mkdir -p "$SESS_DIR"
  cp "$SESSION_FIXTURE" "$SESS_DIR/session.jsonl"
  EVFILE="$TEST_TMP/loop/events-test-slug.ndjson"
}
teardown() {
  unset PYTHONPATH
  rm -rf "${TEST_TMP:-}"
}

usage_event_count() {
  python3 -c "
import json
n = 0
try:
    with open('$EVFILE') as f:
        for line in f:
            if json.loads(line).get('stage') == 'usage':
                n += 1
except FileNotFoundError:
    pass
print(n)
"
}

# ─── loop-fmt passthrough is display-only ─────────────────────────────────

@test "US-LOOP-026: pi passthrough prints to stdout but emits no usage event" {
  export ROLL_LOOP_AGENT="pi"
  run bash -c "printf 'thinking...\ndone.\n' | python3 '$LOOP_FMT'"
  [ "$status" -eq 0 ]
  # display: the agent text is forwarded to stdout
  [[ "$output" == *"thinking..."* ]]
  [[ "$output" == *"done."* ]]
  # but NO usage event is written from the realtime path
  [ "$(usage_event_count)" -eq 0 ]
}

# ─── pi_emit writes exactly one authoritative event ───────────────────────

@test "US-LOOP-026: pi_emit writes exactly one real usage event (CNY cost)" {
  run env ROLL_PI_SESSIONS_DIR="$TEST_TMP/sessions" python3 "$PI_EMIT" \
      --cwd "$WT_CWD" --cycle "test-cycle-int-001" --slug "test-slug" \
      --events "$EVFILE"
  [ "$status" -eq 0 ]
  [ -f "$EVFILE" ]
  [ "$(usage_event_count)" -eq 1 ]

  run python3 -c "
import json
with open('$EVFILE') as f:
    ev = json.loads(f.readline())
d = ev['detail']
assert ev['stage'] == 'usage', ev['stage']
assert ev['label'] == 'test-cycle-int-001', ev['label']
assert d['model'] == 'deepseek-v4-pro', d['model']
assert d['input_tokens'] == 3000, d['input_tokens']
assert d['output_tokens'] == 500, d['output_tokens']
assert d['cost_currency'] == 'CNY', d['cost_currency']
assert d['cost_list_usd'] and d['cost_list_usd'] > 0, d['cost_list_usd']
assert d['cost_reported_usd'] == 0.03, d['cost_reported_usd']
print('OK')
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

@test "US-LOOP-026: pi_emit writes nothing when no session matches" {
  run env ROLL_PI_SESSIONS_DIR="$TEST_TMP/sessions" python3 "$PI_EMIT" \
      --cwd "/no/such/worktree" --cycle "nope" --slug "test-slug" \
      --events "$EVFILE"
  [ "$status" -eq 0 ]
  [ "$(usage_event_count)" -eq 0 ]
}
