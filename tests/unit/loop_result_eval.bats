#!/usr/bin/env bats
# US-EVAL-001: cycle result rubric — pure scoring function.
#
# Drives lib/loop_result_eval.py: given a JSON object of cycle facts, it
# emits the result_eval block {version, score (1..10), dims{...}}. These
# tests pin the rubric's judgement on representative cycles (the good cycle,
# the idle cycle, the over-budget cycle) plus the unknown-fact contract and
# the back-compat schema shape.
# bats tier: fast

load helpers

LIB="${BATS_TEST_DIRNAME}/../../lib/loop_result_eval.py"

# Score a JSON facts blob → result_eval JSON on stdout.
score() { python3 "$LIB" --facts "$1"; }

# Pull one field out of the result_eval JSON with python (no jq dependency).
field() { python3 -c "import json,sys; print(json.loads(sys.stdin.read())$1)"; }

# ── a fully-good cycle scores at the top of the 1..10 band ───────────────────
@test "US-EVAL-001: merged + green CI + on-scope + tested + fast + clean → 10" {
  facts='{"status":"merged","ci":"green","routed_story":"US-X-001",
          "built":["US-X-001"],"tcr_count":3,"duration_sec":300,
          "est_min":10,"alerts":[],"orphans":[]}'
  run score "$facts"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "['score']")" = "10" ]
  [ "$(echo "$output" | field "['dims']['outcome']")" = "1.0" ]
  [ "$(echo "$output" | field "['dims']['scope_fidelity']")" = "1.0" ]
  [ "$(echo "$output" | field "['dims']['quality']")" = "1.0" ]
  [ "$(echo "$output" | field "['dims']['cleanliness']")" = "1.0" ]
}

# ── an idle cycle that merged nothing scores at the floor ────────────────────
@test "US-EVAL-001: idle cycle, nothing merged, no tests, orphan left → score 1" {
  facts='{"status":"idle","ci":"red","routed_story":null,"built":[],
          "tcr_count":0,"alerts":[],"orphans":["loop/cycle-abc"]}'
  run score "$facts"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "['dims']['outcome']")" = "0.0" ]
  [ "$(echo "$output" | field "['dims']['scope_fidelity']")" = "0.0" ]
  [ "$(echo "$output" | field "['dims']['correctness']")" = "0.0" ]
  [ "$(echo "$output" | field "['dims']['cleanliness']")" = "0.0" ]
  # every measurable dimension bottomed out → the 1..10 floor
  [ "$(echo "$output" | field "['score']")" = "1" ]
}

# ── a clean-but-idle cycle is not a literal floor: cleanliness still counts ──
@test "US-EVAL-001: idle but clean cycle scores above the floor (cleanliness lifts it)" {
  facts='{"status":"idle","ci":"red","routed_story":null,"built":[],
          "tcr_count":0,"alerts":[],"orphans":[]}'
  run score "$facts"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "['dims']['cleanliness']")" = "1.0" ]
  [ "$(echo "$output" | field "['score']")" -gt 1 ]
}

# ── over-budget but otherwise fine: efficiency grades down, not to zero ──────
@test "US-EVAL-001: 3x over est_min grades efficiency to the 0.2 floor" {
  # est_min 10 → budget 10 min; duration 1800s = 30 min = 3x over.
  facts='{"status":"merged","ci":"green","routed_story":"US-Y-002",
          "built":["US-Y-002"],"tcr_count":2,"duration_sec":1800,
          "est_min":10,"alerts":[],"orphans":[]}'
  run score "$facts"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "['dims']['efficiency']")" = "0.2" ]
  # still a strong cycle overall (merged + green + on-scope), score > floor
  [ "$(echo "$output" | field "['score']")" -ge 8 ]
}

# ── missing facts → that dimension is "unknown", excluded from the rollup ────
@test "US-EVAL-001: absent CI/duration record dim as unknown, not 0" {
  # No ci, no duration_sec/est_min → correctness + efficiency unknown.
  facts='{"status":"merged","routed_story":"US-Z-003","built":["US-Z-003"],
          "tcr_count":1,"alerts":[],"orphans":[]}'
  run score "$facts"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "['dims']['correctness']")" = "unknown" ]
  [ "$(echo "$output" | field "['dims']['efficiency']")" = "unknown" ]
  # renormalised over known dims (all 1.0 here) → top score, NOT dragged to 0
  [ "$(echo "$output" | field "['score']")" = "10" ]
}

# ── back-compat schema shape: version + score + dims always present ──────────
@test "US-EVAL-001: empty facts still emit a valid versioned schema" {
  run score '{}'
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "['version']")" = "1" ]
  # every rubric dimension is present as a key
  for dim in outcome correctness scope_fidelity quality efficiency cleanliness; do
    echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read())['dims']; assert '$dim' in d, '$dim missing'"
  done
}

# ── alerts/orphans tank cleanliness even on an otherwise-clean merge ─────────
@test "US-EVAL-001: an ALERT this cycle drives cleanliness to 0" {
  facts='{"status":"merged","ci":"green","routed_story":"US-W-004",
          "built":["US-W-004"],"tcr_count":1,"duration_sec":120,
          "est_min":10,"alerts":["stuck story reverted"],"orphans":[]}'
  run score "$facts"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | field "['dims']['cleanliness']")" = "0.0" ]
}

# ── bad JSON is a hard error, not a silent 0-score ───────────────────────────
@test "US-EVAL-001: malformed facts JSON exits non-zero" {
  run score 'not json'
  [ "$status" -eq 1 ]
}
