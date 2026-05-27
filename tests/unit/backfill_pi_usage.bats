#!/usr/bin/env bats
# Unit tests for lib/backfill-pi-usage.py (US-LOOP-026 historical backfill).
#
# The old loop-fmt passthrough appended one null `model:"pi"` usage event per
# retry attempt → up to N empty usage events per cycle. This script recovers
# real tokens from pi's session jsonl and collapses each recoverable cycle to
# EXACTLY ONE authoritative usage event (so the dashboard's same-label SUM is
# not inflated ×N), while leaving claude / already-real / unmatched cycles
# untouched. Re-runnable (idempotent).

BACKFILL="${BATS_TEST_DIRNAME}/../../lib/backfill-pi-usage.py"
SLUG="testproj"

setup() {
  TEST_TMP="$(mktemp -d)"
  SHARED="$TEST_TMP/shared"
  mkdir -p "$SHARED/loop"
  EVFILE="$SHARED/loop/events-$SLUG.ndjson"
  SESS="$TEST_TMP/sessions"
  mkdir -p "$SESS/encoded-L1"
  # Session for cycle L1 — cwd must equal the reconstructed worktree path.
  L1="20260527-100000-1111"
  L2="20260527-110000-2222"
  cat > "$SESS/encoded-L1/s.jsonl" <<EOF
{"type":"session","cwd":"$SHARED/worktrees/$SLUG-cycle-$L1"}
{"type":"message","message":{"role":"assistant","model":"deepseek-v4-pro","usage":{"input":2000,"output":300,"cacheRead":1000,"cacheWrite":0,"cost":{"total":0.05}}}}
{"type":"message","message":{"role":"assistant","model":"deepseek-v4-pro","usage":{"input":1000,"output":200,"cacheRead":500,"cacheWrite":0,"cost":{"total":0.03}}}}
EOF
  # Events: 3 null pi events for L1 (×N), a real claude event, 1 unmatched
  # null pi event for L2, plus interleaved non-usage events.
  {
    echo '{"ts":"2026-05-27T10:00:01Z","stage":"cycle_start","label":"'"$L1"'","detail":"","outcome":"ok"}'
    echo '{"ts":"2026-05-27T10:00:02Z","stage":"usage","label":"'"$L1"'","detail":{"model":"pi","input_tokens":null,"output_tokens":null},"outcome":"ok"}'
    echo '{"ts":"2026-05-27T10:00:03Z","stage":"usage","label":"'"$L1"'","detail":{"model":"pi","input_tokens":null,"output_tokens":null},"outcome":"ok"}'
    echo '{"ts":"2026-05-27T10:00:04Z","stage":"usage","label":"'"$L1"'","detail":{"model":"pi","input_tokens":null,"output_tokens":null},"outcome":"ok"}'
    echo '{"ts":"2026-05-27T10:30:00Z","stage":"usage","label":"claudecycle","detail":{"model":"claude-opus-4-7","input_tokens":5000,"output_tokens":900,"cost_list_usd":1.2,"cost_currency":"USD"},"outcome":"ok"}'
    echo '{"ts":"2026-05-27T11:00:02Z","stage":"usage","label":"'"$L2"'","detail":{"model":"pi","input_tokens":null,"output_tokens":null},"outcome":"ok"}'
  } > "$EVFILE"
}
teardown() { rm -rf "${TEST_TMP:-}"; }

usage_count_for() {
  python3 -c "
import json,sys
lab=sys.argv[1]; n=0
with open('$EVFILE') as f:
    for line in f:
        e=json.loads(line)
        if e.get('stage')=='usage' and e.get('label')==lab: n+=1
print(n)
" "$1"
}

sum_input_for() {
  python3 -c "
import json,sys
lab=sys.argv[1]; s=0
with open('$EVFILE') as f:
    for line in f:
        e=json.loads(line)
        if e.get('stage')=='usage' and e.get('label')==lab:
            s+=int((e.get('detail') or {}).get('input_tokens') or 0)
print(s)
" "$1"
}

run_backfill() {
  python3 "$BACKFILL" --events "$EVFILE" --slug "$SLUG" \
    --shared "$SHARED" --base-dir "$SESS"
}

@test "backfill: L1 collapses 3 null events to exactly one real usage event" {
  run run_backfill
  [ "$status" -eq 0 ]
  [ "$(usage_count_for "$L1")" -eq 1 ]
}

@test "backfill: L1 single event carries summed real tokens (3000), not xN" {
  run_backfill
  # 2000 + 1000 = 3000 input across the two assistant messages, summed ONCE.
  [ "$(sum_input_for "$L1")" -eq 3000 ]
}

@test "backfill: L1 event has CNY cost frozen from snapshot" {
  run_backfill
  run python3 -c "
import json
with open('$EVFILE') as f:
    for line in f:
        e=json.loads(line)
        if e.get('stage')=='usage' and e.get('label')=='$L1':
            d=e['detail']
            assert d['cost_currency']=='CNY', d['cost_currency']
            assert d['cost_list_usd']>0, d['cost_list_usd']
            assert d['model']=='deepseek-v4-pro', d['model']
            assert d['cost_reported_usd']==0.08, d['cost_reported_usd']
            print('OK'); break
"
  [ "$status" -eq 0 ]
  [[ "$output" == *OK* ]]
}

@test "backfill: L1 event preserves the original first-event timestamp" {
  run_backfill
  run python3 -c "
import json
with open('$EVFILE') as f:
    for line in f:
        e=json.loads(line)
        if e.get('stage')=='usage' and e.get('label')=='$L1':
            assert e['ts']=='2026-05-27T10:00:02Z', e['ts']
            print('OK'); break
"
  [ "$status" -eq 0 ]
  [[ "$output" == *OK* ]]
}

@test "backfill: claude usage event left untouched" {
  run_backfill
  [ "$(usage_count_for claudecycle)" -eq 1 ]
  [ "$(sum_input_for claudecycle)" -eq 5000 ]
}

@test "backfill: unmatched pi cycle (no session) stays null, untouched" {
  run_backfill
  # L2 has no session → still its single null event, still null tokens.
  [ "$(usage_count_for "$L2")" -eq 1 ]
  [ "$(sum_input_for "$L2")" -eq 0 ]
}

@test "backfill: non-usage events preserved" {
  run_backfill
  run grep -c '"stage": "cycle_start"\|"stage":"cycle_start"' "$EVFILE"
  [ "$output" -eq 1 ]
}

@test "backfill: writes a timestamped backup" {
  run_backfill
  run bash -c "ls '$SHARED/loop/' | grep -c 'events-$SLUG.ndjson.bak-'"
  [ "$output" -ge 1 ]
}

@test "backfill: idempotent — second run makes no further change" {
  run_backfill
  cp "$EVFILE" "$TEST_TMP/after-first.ndjson"
  run_backfill
  run diff "$TEST_TMP/after-first.ndjson" "$EVFILE"
  [ "$status" -eq 0 ]
}

@test "backfill: dry-run reports matched/unmatched without writing" {
  cp "$EVFILE" "$TEST_TMP/before.ndjson"
  run python3 "$BACKFILL" --events "$EVFILE" --slug "$SLUG" \
    --shared "$SHARED" --base-dir "$SESS" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"matched=1"* ]]
  [[ "$output" == *"unmatched=1"* ]]
  run diff "$TEST_TMP/before.ndjson" "$EVFILE"
  [ "$status" -eq 0 ]
}
