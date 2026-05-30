#!/usr/bin/env bats
# US-EVAL-004: self-evolution signals — repeated low-score patterns become
# improvement signals + candidate backlog drafts (📋 待人确认), deduped per
# pattern and NEVER auto-activating a story or editing code.
#
# Two layers under test:
#   1. the pure detector (lib/loop_result_eval.py --signals): a streak of N
#      low cycles on a dimension fires exactly one signal; a shorter streak or
#      a good cycle in between does not.
#   2. _loop_signals (bin/roll): writes one candidate draft per fresh signal,
#      deduped against signals-seen so a standing pattern is raised once.
# bats tier: fast

load helpers

setup() { unit_setup_cd; }
teardown() { unit_teardown; }

LIB="${BATS_TEST_DIRNAME}/../../lib/loop_result_eval.py"

# Run the detector over a JSON array of records → signals JSON on stdout.
signals() { python3 "$LIB" --signals --streak "${2:-3}" --facts "$1"; }
# Pull a field out of JSON with python (no jq dependency for the pure layer).
field() { python3 -c "import json,sys; print(json.loads(sys.stdin.read())$1)"; }

# A record whose result_eval scores `scope_fidelity` at the given value.
rec() { printf '{"result_eval":{"score":1,"dims":{"scope_fidelity":%s,"outcome":%s}}}' "$1" "$1"; }

# ── 3 consecutive low cycles → exactly one signal for that dimension ─────────
@test "US-EVAL-004: 3 consecutive scope_fidelity=0 cycles fire one signal" {
  recs="[$(rec 0.0),$(rec 0.0),$(rec 0.0)]"
  run signals "$recs"
  [ "$status" -eq 0 ]
  # one signal per low dimension (scope_fidelity AND outcome are both 0 here)
  [ "$(echo "$output" | field "[0]['key']")" = "lowdim:outcome" ]
  # scope_fidelity must be present exactly once
  local count
  count=$(echo "$output" | python3 -c "import json,sys; print(sum(1 for s in json.loads(sys.stdin.read()) if s['key']=='lowdim:scope_fidelity'))")
  [ "$count" = "1" ]
  # scope_fidelity maps to an IDEA candidate (process drift), outcome to FIX
  echo "$output" | python3 -c "import json,sys; d={s['key']:s for s in json.loads(sys.stdin.read())}; assert d['lowdim:scope_fidelity']['kind']=='IDEA'; assert d['lowdim:outcome']['kind']=='FIX'"
}

# ── a streak shorter than the threshold fires nothing ────────────────────────
@test "US-EVAL-004: 2 low cycles is below the streak threshold — no signal" {
  recs="[$(rec 0.0),$(rec 0.0)]"
  run signals "$recs"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "")" = "[]" ]
}

# ── a recent good cycle breaks the streak ────────────────────────────────────
@test "US-EVAL-004: a good cycle since the lows breaks the streak — no signal" {
  # three low, then one good (newest) → streak reset to 0
  recs="[$(rec 0.0),$(rec 0.0),$(rec 0.0),$(rec 1.0)]"
  run signals "$recs"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "")" = "[]" ]
}

# ── unknown cycles neither extend nor break a streak ─────────────────────────
@test "US-EVAL-004: unknown dimension cycles are skipped, real streak still fires" {
  unk='{"result_eval":{"score":5,"dims":{"scope_fidelity":"unknown","outcome":"unknown"}}}'
  recs="[$(rec 0.0),$unk,$(rec 0.0),$unk,$(rec 0.0)]"
  run signals "$recs"
  [ "$status" -eq 0 ]
  local count
  count=$(echo "$output" | python3 -c "import json,sys; print(sum(1 for s in json.loads(sys.stdin.read()) if s['key']=='lowdim:scope_fidelity'))")
  [ "$count" = "1" ]
}

# ── _loop_signals writes one candidate draft and dedups on re-run ────────────
@test "US-EVAL-004: _loop_signals emits a 待人确认 candidate once, then dedups" {
  command -v jq >/dev/null 2>&1 || skip "jq required"
  local proj="${TEST_TMP}/proj"
  mkdir -p "$proj/.roll/loop"
  export ROLL_MAIN_PROJECT="$proj"
  # Runtime dir override so dedup store lands in the sandbox.
  export ROLL_PROJECT_RUNTIME_DIR="$proj/.roll/loop"
  _LOOP_RT_DIR="$proj/.roll/loop"

  local slug; slug=$(_project_slug "$proj")
  # US-LOOP-020: runs.jsonl is now project-local (resolved via ROLL_PROJECT_RUNTIME_DIR).
  local runs="${ROLL_PROJECT_RUNTIME_DIR}/runs.jsonl"
  : > "$runs"
  # three consecutive low-scope cycles for THIS project
  local i
  for i in 1 2 3; do
    printf '{"project":"%s","ts":"2026-05-30T0%d:00:00Z","result_eval":{"score":1,"dims":{"scope_fidelity":0.0,"outcome":0.0}}}\n' "$slug" "$i" >> "$runs"
  done

  run _loop_signals
  [ "$status" -eq 0 ]
  [[ "$output" == *"candidate"* ]]
  local cand="$proj/.roll/signals/candidates.md"
  [ -f "$cand" ]
  grep -q "待人确认" "$cand"
  # one candidate per fired pattern (scope_fidelity + outcome) → 2 drafts
  local n1; n1=$(grep -c "📋 待人确认" "$cand")
  [ "$n1" -eq 2 ]

  # Re-run with the same standing pattern → deduped, no new drafts appended.
  run _loop_signals
  [ "$status" -eq 0 ]
  [[ "$output" == *"no new improvement signals"* ]]
  local n2; n2=$(grep -c "📋 待人确认" "$cand")
  [ "$n2" -eq 2 ]
}

# ── _loop_signals never touches the real backlog ─────────────────────────────
@test "US-EVAL-004: _loop_signals leaves .roll/backlog.md untouched (only exposes)" {
  command -v jq >/dev/null 2>&1 || skip "jq required"
  local proj="${TEST_TMP}/proj2"
  mkdir -p "$proj/.roll/loop"
  printf '| ID | Desc | est | risk | 📋 Todo |\n' > "$proj/.roll/backlog.md"
  local before; before=$(cat "$proj/.roll/backlog.md")
  export ROLL_MAIN_PROJECT="$proj"
  export ROLL_PROJECT_RUNTIME_DIR="$proj/.roll/loop"
  _LOOP_RT_DIR="$proj/.roll/loop"

  local slug; slug=$(_project_slug "$proj")
  # US-LOOP-020: runs.jsonl is now project-local (resolved via ROLL_PROJECT_RUNTIME_DIR).
  local runs="${ROLL_PROJECT_RUNTIME_DIR}/runs.jsonl"
  : > "$runs"
  local i
  for i in 1 2 3; do
    printf '{"project":"%s","ts":"2026-05-30T0%d:00:00Z","result_eval":{"score":1,"dims":{"scope_fidelity":0.0,"outcome":0.0}}}\n' "$slug" "$i" >> "$runs"
  done

  run _loop_signals
  [ "$status" -eq 0 ]
  # the real backlog is byte-for-byte unchanged
  [ "$(cat "$proj/.roll/backlog.md")" = "$before" ]
}
