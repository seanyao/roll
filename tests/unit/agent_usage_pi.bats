#!/usr/bin/env bats
# Unit tests for lib/agent_usage/pi.py
#
# pi runs as `pi -p` (text mode): stdout is only the answer, no usage. So
# extract() always returns None and usage is recovered from pi's persisted
# session jsonl files via usage_from_session().

LIB_DIR="${BATS_TEST_DIRNAME}/../../lib"
FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/pi_session_sample.jsonl"

setup() {
  TEST_TMP="$(mktemp -d)"
  # pi sessions root is scanned as <base>/*/*.jsonl — one dir deep.
  SESS_DIR="${TEST_TMP}/sessions/encoded-cwd"
  mkdir -p "${SESS_DIR}"
  cp "${FIXTURE}" "${SESS_DIR}/session.jsonl"
}
teardown() {
  rm -rf "${TEST_TMP:-}"
}

# Run usage_from_session(**kwargs) with ROLL_PI_SESSIONS_DIR pointed at TEST_TMP.
run_from_session() {
  ROLL_PI_SESSIONS_DIR="${TEST_TMP}/sessions" python3 -c "
import sys, json
sys.path.insert(0, '${LIB_DIR}')
from agent_usage.pi import usage_from_session
print(json.dumps(usage_from_session($1)))
"
}

# ─── extract() is a stub (text mode carries no usage) ─────────────────────

@test "pi.extract() always returns None (text mode has no usage)" {
  run python3 -c "
import sys; sys.path.insert(0, '${LIB_DIR}')
from agent_usage.pi import extract
print(extract(['Input: 15000', 'Cost: 0.15', 'whatever']))
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}

@test "pi.extract() returns None for empty input" {
  run python3 -c "
import sys; sys.path.insert(0, '${LIB_DIR}')
from agent_usage.pi import extract
print(extract([]))
"
  [ "$status" -eq 0 ]
  [ "$output" = "None" ]
}

# ─── usage_from_session: match by cwd, sum per-message usage ──────────────

@test "usage_from_session sums tokens across assistant messages (match by cwd)" {
  run run_from_session "cwd='/sandbox/worktrees/roll-cycle-TESTCYCLE'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 3000'* ]]
  [[ "$output" == *'"output_tokens": 500'* ]]
  [[ "$output" == *'"cache_read_tokens": 1500'* ]]
  [[ "$output" == *'"cache_creation_tokens": 100'* ]]
  [[ "$output" == *'"model": "deepseek-v4-pro"'* ]]
}

@test "usage_from_session keeps pi's reported cost for audit (cost_reported)" {
  run run_from_session "cwd='/sandbox/worktrees/roll-cycle-TESTCYCLE'"
  [ "$status" -eq 0 ]
  # 0.01 + 0.02 = 0.03 (pi's own USD number, audit only — not authoritative)
  [[ "$output" == *'"cost_reported": 0.03'* ]]
  # The parser must NOT emit an authoritative cost field or a currency —
  # the writer freezes that from the CNY snapshot.
  [[ "$output" != *'cost_list_usd'* ]]
  [[ "$output" != *'cost_currency'* ]]
}

@test "usage_from_session matches by cycle_id when cwd not given (dir fallback)" {
  # Rename the session dir to embed the cycle id in its path.
  mv "${TEST_TMP}/sessions/encoded-cwd" "${TEST_TMP}/sessions/roll-cycle-ABC123"
  run run_from_session "cycle_id='ABC123'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"input_tokens": 3000'* ]]
}

@test "usage_from_session returns None when nothing matches" {
  run run_from_session "cwd='/no/such/worktree'"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}

@test "usage_from_session sums across multiple session files (retries)" {
  # A retry reuses the same worktree → a second session file with same cwd.
  cp "${FIXTURE}" "${TEST_TMP}/sessions/encoded-cwd/retry.jsonl"
  run run_from_session "cwd='/sandbox/worktrees/roll-cycle-TESTCYCLE'"
  [ "$status" -eq 0 ]
  # Two identical files → doubled token totals.
  [[ "$output" == *'"input_tokens": 6000'* ]]
  [[ "$output" == *'"output_tokens": 1000'* ]]
}
