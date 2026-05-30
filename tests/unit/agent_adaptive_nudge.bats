#!/usr/bin/env bats
# US-AGENT-030: transparent, auditable in-tier adaptive soft nudge.
#
# On top of the est_min complexity tier (a HARD constraint — never crossed),
# prefer the same-tier candidate agent with the best per-(agent × story_type)
# historical hit-rate. Distinct from the US-AGENT-022-retired soft preference:
# this is deterministic, sample-floored, auditable, and one-switch disableable.
#
# Two layers under test:
#   1. the pure read model + reorder (lib/loop_result_eval.py --hit-rates,
#      lib/loop_pick_agent.py --nudge) — deterministic, no machine state.
#   2. the wired router (_loop_pick_agent_for_story) honouring runs.jsonl
#      history, the disable switch, and the tier hard constraint.
# bats tier: fast

load helpers

EVAL="${BATS_TEST_DIRNAME}/../../lib/loop_result_eval.py"
PICK="${BATS_TEST_DIRNAME}/../../lib/loop_pick_agent.py"

setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# Pull a key whose name contains the \x1f unit separator out of the hit-rates
# JSON. Avoids embedding a literal \x1f in the .bats source.
_hr_field() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['$1\x1f$2']$3)"; }

# Build a hit-rates JSON with the real "<agent>\x1f<story_type>" keys the read
# model emits. Args repeat as: agent hit_rate sample_n (story_type fixed US).
_hr_json() {
  python3 -c '
import json,sys
a=sys.argv[1:]
d={}
for i in range(0,len(a),3):
    ag,hr,n=a[i],float(a[i+1]),int(a[i+2])
    d["%s\x1fUS"%ag]={"agent":ag,"story_type":"US","hit_rate":hr,"sample_n":n}
print(json.dumps(d))
' "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — pure functions (python CLIs)
# ─────────────────────────────────────────────────────────────────────────────

@test "hit-rates: counts hits (score>=8) per agent x story_type, with sample_n" {
  records='[
    {"agent":"kimi","story_type":"US","result_eval":{"score":9}},
    {"agent":"kimi","story_type":"US","result_eval":{"score":8}},
    {"agent":"kimi","story_type":"US","result_eval":{"score":4}},
    {"agent":"claude","story_type":"US","result_eval":{"score":10}}
  ]'
  run bash -c "printf '%s' '$records' | python3 '$EVAL' --hit-rates"
  [ "$status" -eq 0 ]
  # kimi×US: 2 hits / 3 → 0.666..., n=3
  [ "$(echo "$output" | _hr_field kimi US "['sample_n']")" = "3" ]
  echo "$output" | python3 -c "import json,sys; k=json.loads(sys.stdin.read())['kimi\x1fUS']; assert abs(k['hit_rate']-2/3)<1e-9, k"
  # claude×US: 1/1 → 1.0
  [ "$(echo "$output" | _hr_field claude US "['hit_rate']")" = "1.0" ]
}

@test "hit-rates: records without agent/story_type/score are ignored, never counted as 0" {
  records='[
    {"agent":"kimi","story_type":"US","result_eval":{"score":9}},
    {"agent":"kimi","story_type":"US"},
    {"story_type":"US","result_eval":{"score":2}},
    {"agent":"kimi","result_eval":{"score":2}}
  ]'
  run bash -c "printf '%s' '$records' | python3 '$EVAL' --hit-rates"
  [ "$status" -eq 0 ]
  # Only the first row counts: 1 hit / 1.
  [ "$(echo "$output" | _hr_field kimi US "['sample_n']")" = "1" ]
  [ "$(echo "$output" | _hr_field kimi US "['hit_rate']")" = "1.0" ]
}

@test "hit-rates: deterministic — same records (any order) → identical JSON" {
  a='[{"agent":"kimi","story_type":"US","result_eval":{"score":9}},{"agent":"claude","story_type":"US","result_eval":{"score":8}}]'
  b='[{"agent":"claude","story_type":"US","result_eval":{"score":8}},{"agent":"kimi","story_type":"US","result_eval":{"score":9}}]'
  out_a="$(printf '%s' "$a" | python3 "$EVAL" --hit-rates)"
  out_b="$(printf '%s' "$b" | python3 "$EVAL" --hit-rates)"
  [ "$out_a" = "$out_b" ]
}

@test "nudge: in-tier candidate with higher hit-rate (n>=floor) wins over slot" {
  hr="$(_hr_json kimi 0.61 14 claude 0.86 12)"
  run bash -c "printf '%s' '$hr' | python3 '$PICK' --nudge --slot-agent kimi --story-type US --candidates claude"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | cut -f1)" = "claude" ]
  printf '%s' "$output" | grep -q "prefer claude"
}

@test "nudge: combo below sample floor is ignored → slot agent kept" {
  hr="$(_hr_json kimi 0.61 3 claude 0.99 4)"
  run bash -c "printf '%s' '$hr' | python3 '$PICK' --nudge --slot-agent kimi --story-type US --candidates claude"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | cut -f1)" = "kimi" ]
  printf '%s' "$output" | grep -q "n<8"
}

@test "nudge: --disabled is an exact identity (keeps slot agent regardless of history)" {
  hr="$(_hr_json claude 0.99 50)"
  run bash -c "printf '%s' '$hr' | python3 '$PICK' --nudge --slot-agent kimi --story-type US --candidates claude --disabled"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | cut -f1)" = "kimi" ]
  printf '%s' "$output" | grep -q "disabled"
}

@test "nudge: deterministic tie-break keeps slot agent on equal hit-rates" {
  hr="$(_hr_json kimi 0.80 10 claude 0.80 20)"
  run bash -c "printf '%s' '$hr' | python3 '$PICK' --nudge --slot-agent kimi --story-type US --candidates claude"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | cut -f1)" = "kimi" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — wired router (_loop_pick_agent_for_story)
# ─────────────────────────────────────────────────────────────────────────────

# Minimal project: one default-tier story + agents.yaml binding default→kimi,
# plus runs.jsonl where claude beats kimi on default-tier US stories (both n≥8).
_seed_router() {
  mkdir -p .roll/features/test-epic
  cat > .roll/backlog.md <<'MD'
# Project Backlog

| [US-DEF-012](.roll/features/test-epic/t.md#us-def-012) | default | 📋 Todo |
MD
  cat > .roll/features/test-epic/t.md <<'MD'
# Feature: test

<a id="us-def-012"></a>
## US-DEF-012 default
**Agent profile:**
- est_min: 12
- risk_zone: low
- chain_depth: 0
MD
  cat > .roll/agents.yaml <<'YAML'
schema: v3
easy:     { agent: kimi }
default:  { agent: kimi }
hard:     { agent: codex }
fallback: { agent: pi }
YAML
  export ROLL_PROJECT_RUNTIME_DIR="${TEST_TMP}/rt"
  mkdir -p "$ROLL_PROJECT_RUNTIME_DIR"
  : > "$ROLL_PROJECT_RUNTIME_DIR/runs.jsonl"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    printf '{"agent":"claude","tier":"default","story_type":"US","result_eval":{"score":9}}\n' \
      >> "$ROLL_PROJECT_RUNTIME_DIR/runs.jsonl"
    printf '{"agent":"kimi","tier":"default","story_type":"US","result_eval":{"score":4}}\n' \
      >> "$ROLL_PROJECT_RUNTIME_DIR/runs.jsonl"
  done
  # Both agents count as installed for the candidate-pool intersection.
  _agents_installed() { printf 'claude\nkimi\n'; }
}

@test "router: nudge reorders default tier kimi→claude on history, tier stays default" {
  _seed_router
  run _loop_pick_agent_for_story US-DEF-012
  [ "$status" -eq 0 ]
  # field 1 = agent the loop runs; nudged to the better in-tier performer.
  [ "$(echo "$output" | awk '{print $1}')" = "claude" ]
  # field 2 = tier — the HARD constraint is never crossed.
  [ "$(echo "$output" | awk '{print $2}')" = "default" ]
  # Audit trail: the route line carries the human-readable nudge reason.
  echo "$output" | grep -q "nudge:"
}

@test "router: ROLL_AGENT_NUDGE=0 == US-AGENT-023 behaviour (slot agent kimi kept)" {
  _seed_router
  ROLL_AGENT_NUDGE=0 run _loop_pick_agent_for_story US-DEF-012
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "kimi" ]
  [ "$(echo "$output" | awk '{print $2}')" = "default" ]
}

@test "router: no runs.jsonl history → slot agent kept (bootstrap == pure est_min routing)" {
  _seed_router
  : > "$ROLL_PROJECT_RUNTIME_DIR/runs.jsonl"   # wipe history
  run _loop_pick_agent_for_story US-DEF-012
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | awk '{print $1}')" = "kimi" ]
  [ "$(echo "$output" | awk '{print $2}')" = "default" ]
}
