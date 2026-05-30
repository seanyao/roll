#!/usr/bin/env bats
# Unit tests for lib/loop-fmt.py (US-LOOP-002)

LOOP_FMT="${BATS_TEST_DIRNAME}/../../lib/loop-fmt.py"

setup() {
  TEST_TMP="$(mktemp -d)"
}
teardown() { rm -rf "${TEST_TMP:-}"; }

run_fmt() {
  echo "$1" | python3 "$LOOP_FMT"
}

strip_ansi() {
  sed 's/\x1b\[[0-9;]*m//g'
}

# ─── Tier 3: suppression ────────────────────────────────────────────────────

@test "Tier 3: system init event produces no output" {
  local ev='{"type":"system","subtype":"init","model":"claude-3","tools":[]}'
  run run_fmt "$ev"
  [ "${#output}" -eq 0 ]
}

@test "Tier 3: thinking block produces no output" {
  local ev='{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"let me think..."}]}}'
  run run_fmt "$ev"
  [ "${#output}" -eq 0 ]
}

@test "Tier 3: Read tool call produces no output" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/foo/bar.py"}}]}}'
  run run_fmt "$ev"
  [ "${#output}" -eq 0 ]
}

@test "Tier 3: Glob tool call produces no output" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Glob","input":{"pattern":"**/*.py"}}]}}'
  run run_fmt "$ev"
  [ "${#output}" -eq 0 ]
}

@test "Tier 3: Grep tool call produces no output" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"foo"}}]}}'
  run run_fmt "$ev"
  [ "${#output}" -eq 0 ]
}

@test "Tier 3: non-error tool result for plain Bash produces no output" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls -la"}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"file1.txt\nfile2.txt"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | python3 '$LOOP_FMT'"
  [ "${#output}" -eq 0 ]
}

@test "Tier 3: plain text that is not cycle marker produces no output" {
  run run_fmt "some random agent thinking text"
  [ "${#output}" -eq 0 ]
}

# ─── Tier 2: Edit/Write ──────────────────────────────────────────────────────

@test "Tier 2: Edit tool call outputs checkmark and path" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/auth/token.ts","old_string":"x","new_string":"y"}}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"✏"* ]]
  [[ "$clean" == *"token.ts"* ]]
}

@test "Tier 2: Write tool call outputs checkmark and path" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/src/new-file.ts"}}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"✏"* ]]
  [[ "$clean" == *"new-file.ts"* ]]
}

@test "Tier 2: Edit output is exactly 1 non-empty line" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/a.py","old_string":"x","new_string":"y"}}]}}'
  run run_fmt "$ev"
  local count; count=$(echo "$output" | grep -c '.')
  [ "$count" -le 1 ]
}

# ─── Tier 1: tcr commit ──────────────────────────────────────────────────────

@test "Tier 1: tcr git commit produces step with hash" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -m \"tcr: add token validation\""}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"[main a3f1b2c] tcr: add token validation\n 2 files changed"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"tcr"* ]]
  [[ "$clean" == *"a3f1b2c"* ]]
}

@test "Tier 1: tcr step includes commit message" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -m \"tcr: handle refresh flow\""}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"[main c9d04e1] tcr: handle refresh flow\n 1 file changed"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"handle refresh flow"* ]]
}

@test "Tier 1: tcr step with test count from prior bats result" {
  local bash_ev_bats='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"bats tests/"}}]}}'
  local bats_result='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"ok 23 tests passed"}]}}'
  local bash_ev_commit='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -m \"tcr: validate tokens\""}}]}}'
  local commit_result='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"[main d4e5f6a] tcr: validate tokens\n 2 files changed"}]}}'
  run bash -c "printf '%s\n%s\n%s\n%s\n' '$bash_ev_bats' '$bats_result' '$bash_ev_commit' '$commit_result' | python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"tcr"* ]]
  [[ "$clean" == *"23 tests"* ]]
}

# ─── Tier 1: story skill ────────────────────────────────────────────────────

@test "Tier 1: Skill roll-build produces story step" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"roll-build","args":"US-AUTH-003 user login with OAuth"}}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"story"* ]]
  [[ "$clean" == *"US-AUTH-003"* ]]
}

@test "Tier 1: Skill roll-fix produces story step" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"roll-fix","args":"FIX-042 null pointer in login"}}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"story"* ]]
  [[ "$clean" == *"FIX-042"* ]]
}

# ─── Tier 1: peer verdict ───────────────────────────────────────────────────

@test "Tier 1: agent text with AGREE produces peer step" {
  local ev='{"type":"assistant","message":{"content":[{"type":"text","text":"round 1/3 verdict: AGREE on the approach"}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"peer"* ]]
  [[ "$clean" == *"AGREE"* ]]
}

@test "Tier 1: agent text with REFINE produces peer step" {
  local ev='{"type":"assistant","message":{"content":[{"type":"text","text":"round 2/3: REFINE the implementation"}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"peer"* ]]
  [[ "$clean" == *"REFINE"* ]]
}

@test "Tier 1: agent text with OBJECT produces peer step" {
  local ev='{"type":"assistant","message":{"content":[{"type":"text","text":"round 2/3: OBJECT to this plan"}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"peer"* ]]
  [[ "$clean" == *"OBJECT"* ]]
}

@test "Tier 1: agent text with ESCALATE produces peer step" {
  local ev='{"type":"assistant","message":{"content":[{"type":"text","text":"round 3/3: ESCALATE to human"}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"peer"* ]]
  [[ "$clean" == *"ESCALATE"* ]]
}

@test "Tier 1: peer step without verdict keyword is suppressed" {
  local ev='{"type":"assistant","message":{"content":[{"type":"text","text":"I am analyzing the codebase"}]}}'
  run run_fmt "$ev"
  [ "${#output}" -eq 0 ]
}

# ─── Tier 1: error ──────────────────────────────────────────────────────────

@test "Tier 1: is_error result produces error step" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls nonexistent"}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"ls: nonexistent: No such file or directory"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"error"* ]]
}

# ─── Tier 1: cycle stamp ────────────────────────────────────────────────────

@test "Tier 1: [loop] cycle plain text produces timestamp stamp" {
  run run_fmt "[loop] cycle 047: worktree /tmp/wt on loop/cycle-047"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"cycle #047"* ]]
  [[ "$clean" == *"picking story"* ]]
}

@test "Tier 1: result event produces done stamp" {
  local ev='{"type":"result","subtype":"success","duration_ms":372000,"total_cost_usd":1.24,"num_turns":42}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"done"* ]]
}

@test "Tier 1: result stamp contains HH:MM:SS time format" {
  local ev='{"type":"result","subtype":"success","duration_ms":372000,"total_cost_usd":1.24,"num_turns":42}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" =~ [0-9][0-9]:[0-9][0-9]:[0-9][0-9] ]]
}

@test "Tier 1: result event error_max_turns produces error step" {
  local ev='{"type":"result","subtype":"error_max_turns","duration_ms":100000,"total_cost_usd":0.5}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"error"* ]]
  [[ "$clean" == *"max-turns"* ]]
}

# ─── Tier 1: CI gate ─────────────────────────────────────────────────────────

@test "Tier 1: roll ci success produces ci green step" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"roll ci"}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"all tests passed\n43s\n26 tests"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"ci"* ]]
  [[ "$clean" == *"green"* ]]
}

@test "Tier 1: npm run ci failure produces ci red step" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm run ci"}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"error: tests failed\n3 errors"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"ci"* ]]
  [[ "$clean" == *"red"* ]]
}

# ─── Tier 1: PR ──────────────────────────────────────────────────────────────

@test "Tier 1: gh pr create produces pr step with number" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"gh pr create --title test --body body --head loop/cycle-047"}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"https://github.com/org/repo/pull/312\nCreated PR #312"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"pr"* ]]
  [[ "$clean" == *"#312"* ]]
}

# ─── ANSI color checks ───────────────────────────────────────────────────────

@test "Output contains ANSI escape sequences (colors enabled)" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/a.py","old_string":"x","new_string":"y"}}]}}'
  run run_fmt "$ev"
  # Raw output should contain ANSI codes
  [[ "$output" == *$'\033['* ]]
}

@test "Tier 1 step arrow is present in step output" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"roll-build","args":"US-TEST-001 test story"}}]}}'
  run run_fmt "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"→"* ]]
}

# ─── US-LOOP-003: spinner wait points ────────────────────────────────────────

run_fmt_nospin() {
  LOOP_FMT_NO_SPIN=1 bash -c "echo '$1' | python3 '$LOOP_FMT'"
}

@test "Spinner: Skill roll-build shows executing-story waiting indicator" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"roll-build","args":"US-AUTH-003 login flow"}}]}}'
  run bash -c "echo '$ev' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"executing story"* ]]
}

@test "Spinner: roll ci command shows waiting-for-CI indicator" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"roll ci --wait"}}]}}'
  run bash -c "echo '$bash_ev' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"waiting for CI"* ]]
}

@test "Spinner: gh pr create/merge shows merging-PR indicator" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"gh pr merge 42 --auto --squash"}}]}}'
  run bash -c "echo '$bash_ev' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"merging PR"* ]]
}

@test "Spinner: CI result still produces ci step after waiting indicator" {
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"roll ci --wait"}}]}}'
  local result_ev='{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"CI passed\n45 tests"}]}}'
  run bash -c "printf '%s\n%s\n' '$bash_ev' '$result_ev' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"waiting for CI"* ]]
  [[ "$clean" == *"ci"* ]]
  [[ "$clean" == *"green"* ]]
}

# ─── US-VIEW-010: cumulative token accumulation across assistant turns ──────

@test "Usage event: tokens accumulate across multiple assistant turns" {
  local a1='{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":20,"cache_read_input_tokens":1000}}}'
  local a2='{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":3,"output_tokens":7,"cache_creation_input_tokens":0,"cache_read_input_tokens":2000}}}'
  local res='{"type":"result","subtype":"success","duration_ms":1000,"total_cost_usd":0.5}'
  EVDIR="$TEST_TMP"
  LOOP_PROJECT_SLUG=test-slug LOOP_CYCLE_ID=test-cycle LOOP_SHARED_ROOT="$EVDIR" \
    bash -c "printf '%s\n%s\n%s\n' '$a1' '$a2' '$res' | python3 '$LOOP_FMT'"
  evfile="$EVDIR/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]
  local usage_line; usage_line=$(grep '"stage": "usage"' "$evfile" | head -1)
  [ -n "$usage_line" ]
  # input_tokens should be 100+3=103, output 50+7=57, cache_creation 20, cache_read 3000
  echo "$usage_line" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())['detail']
assert d['input_tokens']         == 103, f\"input  expected 103, got {d['input_tokens']}\"
assert d['output_tokens']        ==  57, f\"output expected 57, got {d['output_tokens']}\"
assert d['cache_creation_tokens']==  20, f\"cache_create expected 20, got {d['cache_creation_tokens']}\"
assert d['cache_read_tokens']    ==3000, f\"cache_read expected 3000, got {d['cache_read_tokens']}\"
"
}

# ─── FIX-099: usage event skip on stale/placeholder data ──────────────────────

@test "FIX-099: usage event NOT written when model empty + cost=0 + dur=0 (stale placeholder)" {
  # Regression for the 3-cycle pattern: events.ndjson showed cost=\$1.24 dur=372s
  # in three consecutive cycles where claude returned no real usage. The old code
  # always wrote the event even when all fields were zeros/empty.
  local res='{"type":"result","subtype":"success","duration_ms":0,"total_cost_usd":0}'
  EVDIR="$TEST_TMP"
  LOOP_PROJECT_SLUG=test-slug LOOP_CYCLE_ID=test-cycle-stale LOOP_SHARED_ROOT="$EVDIR" \
    bash -c "echo '$res' | python3 '$LOOP_FMT'" >/dev/null
  # Usage event must NOT be written when no real data was returned.
  local evfile="$EVDIR/loop/events-test-slug.ndjson"
  if [ -f "$evfile" ]; then
    # If file exists, the stale cycle's event must not be present.
    run grep '"label": "test-cycle-stale"' "$evfile"
    [ "$status" -ne 0 ]
  fi
}

@test "FIX-099: usage event IS written when model present even if cost=0" {
  # A real (but free) cycle must still emit usage data when the model field is set.
  local a1='{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":50,"output_tokens":10}}}'
  local res='{"type":"result","subtype":"success","duration_ms":5000,"total_cost_usd":0}'
  EVDIR="$TEST_TMP"
  LOOP_PROJECT_SLUG=test-slug LOOP_CYCLE_ID=test-cycle-real LOOP_SHARED_ROOT="$EVDIR" \
    bash -c "printf '%s\n%s\n' '$a1' '$res' | python3 '$LOOP_FMT'" >/dev/null
  local evfile="$EVDIR/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]
  grep -q '"label": "test-cycle-real"' "$evfile"
}

@test "FIX-099: usage event IS written when cost > 0 (no model in result)" {
  # When claude returns real cost data, must write even if model not in result event.
  local res='{"type":"result","subtype":"success","duration_ms":100000,"total_cost_usd":1.23}'
  EVDIR="$TEST_TMP"
  LOOP_PROJECT_SLUG=test-slug LOOP_CYCLE_ID=test-cycle-cost LOOP_SHARED_ROOT="$EVDIR" \
    bash -c "echo '$res' | python3 '$LOOP_FMT'" >/dev/null
  local evfile="$EVDIR/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]
  grep -q '"label": "test-cycle-cost"' "$evfile"
}

@test "FIX-099: usage event model field is null (not empty string) when not set" {
  # When model is unavailable, write null explicitly so dashboards show n/a.
  local res='{"type":"result","subtype":"success","duration_ms":60000,"total_cost_usd":0.5}'
  EVDIR="$TEST_TMP"
  LOOP_PROJECT_SLUG=test-slug LOOP_CYCLE_ID=test-cycle-null-model LOOP_SHARED_ROOT="$EVDIR" \
    bash -c "echo '$res' | python3 '$LOOP_FMT'" >/dev/null
  local evfile="$EVDIR/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]
  local usage_line; usage_line=$(grep '"label": "test-cycle-null-model"' "$evfile" | head -1)
  [ -n "$usage_line" ]
  # model must be null (JSON null), not empty string ""
  echo "$usage_line" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())['detail']
assert d.get('model') is None, f'expected model=null, got {repr(d.get(\"model\"))}'
"
}

# ─── US-VIEW-014: cost_list_usd + prices_version persisted in usage event ──────

@test "US-VIEW-014: usage event carries cost_list_usd + prices_version when model is known" {
  local a1='{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":200,"cache_read_input_tokens":122089}}}'
  local res='{"type":"result","subtype":"success","duration_ms":300000,"total_cost_usd":9.25}'
  EVDIR="$TEST_TMP"
  LOOP_PROJECT_SLUG=test-slug LOOP_CYCLE_ID=test-cycle-priced LOOP_SHARED_ROOT="$EVDIR" \
    bash -c "printf '%s\n%s\n' '$a1' '$res' | python3 '$LOOP_FMT'" >/dev/null
  local evfile="$EVDIR/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]
  local usage_line; usage_line=$(grep '"label": "test-cycle-priced"' "$evfile" | head -1)
  [ -n "$usage_line" ]
  echo "$usage_line" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())['detail']
# cost_list_usd present and a positive float (sonnet-4-6 priced math)
assert isinstance(d.get('cost_list_usd'), float), f'cost_list_usd missing: {d}'
assert d['cost_list_usd'] > 0, f'expected positive cost_list_usd, got {d[\"cost_list_usd\"]!r}'
# prices_version present and shaped like YYYY-MM-DD
pv = d.get('prices_version')
assert isinstance(pv, str) and len(pv) >= 8, f'prices_version missing or wrong shape: {pv!r}'
"
}

@test "US-VIEW-014: usage event with no model still carries prices_version (cost_list_usd may be null)" {
  # When model is unknown, list-cost falls back via _resolve; we still tag the
  # event with the active snapshot version so dashboards can label the cycle.
  local res='{"type":"result","subtype":"success","duration_ms":60000,"total_cost_usd":0.5}'
  EVDIR="$TEST_TMP"
  LOOP_PROJECT_SLUG=test-slug LOOP_CYCLE_ID=test-cycle-no-model LOOP_SHARED_ROOT="$EVDIR" \
    bash -c "echo '$res' | python3 '$LOOP_FMT'" >/dev/null
  local evfile="$EVDIR/loop/events-test-slug.ndjson"
  [ -f "$evfile" ]
  local usage_line; usage_line=$(grep '"label": "test-cycle-no-model"' "$evfile" | head -1)
  [ -n "$usage_line" ]
  echo "$usage_line" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())['detail']
# prices_version always present once any data is emitted; cost_list_usd is null
# when there are no token counts to multiply against the price table.
assert d.get('cost_list_usd') is None, f'expected null cost_list_usd, got {d.get(\"cost_list_usd\")!r}'
pv = d.get('prices_version')
assert isinstance(pv, str) and len(pv) >= 8, f'prices_version missing: {pv!r}'
"
}

# ─── US-VIEW-020: consecutive same-file Edit folding ─────────────────────────

@test "US-VIEW-020: Edit path is basename, not full path" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/very/long/nested/src/auth/token.ts","old_string":"x","new_string":"y"}}]}}'
  run run_fmt_nospin "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"token.ts"* ]]
  [[ "$clean" != *"/very/long/nested"* ]]
}

@test "US-VIEW-020: 3 consecutive same-file Edits fold to one ×3 line" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/token.ts","old_string":"a","new_string":"b"}}]}}'
  run bash -c "printf '%s\n%s\n%s\n' '$ev' '$ev' '$ev' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  # final fold line shows ×3 (US-VIEW-021 inserts a ` | <hint>` before ×N)
  [[ "$clean" == *"token.ts"* ]]
  [[ "$clean" == *"×3"* ]]
  # no full path leaked
  [[ "$clean" != *"/src/token.ts"* ]]
}

@test "US-VIEW-020: cross-file switch flushes prior streak and starts new line" {
  local a='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/a.ts","old_string":"x","new_string":"y"}}]}}'
  local b='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/b.ts","old_string":"x","new_string":"y"}}]}}'
  run bash -c "printf '%s\n%s\n%s\n' '$a' '$a' '$b' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  # a.ts folded to ×2 (US-VIEW-021 may insert ` | <hint>` before ×N),
  # then b.ts begins as its own line
  [[ "$clean" == *"a.ts"* ]]
  [[ "$clean" == *"×2"* ]]
  [[ "$clean" == *"b.ts"* ]]
  # b.ts should be a fresh single edit (no ×N)
  echo "$clean" | grep -q "b.ts" 
  ! echo "$clean" | grep -q "b.ts ×"
}

@test "US-VIEW-020: Edit then Bash then Edit does not fold across the Bash" {
  local e='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/c.ts","old_string":"x","new_string":"y"}}]}}'
  local bash_ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -m \"tcr: x\""}}]}}'
  run bash -c "printf '%s\n%s\n%s\n' '$e' '$bash_ev' '$e' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  # never folds to ×2 — the Bash between them breaks the streak
  [[ "$clean" != *"×2"* ]]
  # two separate c.ts lines
  local n; n=$(echo "$clean" | grep -c "c.ts")
  [ "$n" -eq 2 ]
}

@test "US-VIEW-020: cycle result flushes residual streak (final ✏ line present)" {
  local e='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/d.ts","old_string":"x","new_string":"y"}}]}}'
  local res='{"type":"result","subtype":"success","duration_ms":1000,"total_cost_usd":0}'
  run bash -c "printf '%s\n%s\n%s\n' '$e' '$e' '$res' | LOOP_FMT_NO_SPIN=1 python3 '$LOOP_FMT'"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"d.ts"* ]]
  [[ "$clean" == *"×2"* ]]
  # cycle summary still printed after the streak
  [[ "$clean" == *"done"* ]]
}

# ─── US-VIEW-021: per-Edit change-feature hint ───────────────────────────────

@test "US-VIEW-021: replace_all=true renders 'replace-all' hint" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/r.ts","old_string":"x","new_string":"y","replace_all":true}}]}}'
  run run_fmt_nospin "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"r.ts | replace-all"* ]]
}

@test "US-VIEW-021: multi-line new_string takes first non-blank line's token" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/m.ts","old_string":"x","new_string":"\n  export function foo() {\n  return 1\n}"}}]}}'
  run run_fmt_nospin "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"m.ts | export"* ]]
}

@test "US-VIEW-021: long token is truncated to 20 chars with ellipsis" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/l.ts","old_string":"x","new_string":"superDuperLongIdentifierNameHere=1"}}]}}'
  run run_fmt_nospin "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  # 20-char prefix then …
  [[ "$clean" == *"l.ts | superDuperLongIdenti…"* ]]
}

@test "US-VIEW-021: empty new_string yields no ' | ' separator" {
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/e.ts","old_string":"x","new_string":"   "}}]}}'
  run run_fmt_nospin "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  [[ "$clean" == *"e.ts"* ]]
  [[ "$clean" != *"e.ts |"* ]]
}

@test "US-VIEW-021: unicode token counted by char, not byte" {
  # 22 Chinese chars → truncated to 20 + … (byte length would over-cut)
  local ev='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/u.ts","old_string":"x","new_string":"一二三四五六七八九十一二三四五六七八九十廿一"}}]}}'
  run run_fmt_nospin "$ev"
  local clean; clean=$(echo "$output" | strip_ansi)
  # first 20 chars then ellipsis
  [[ "$clean" == *"u.ts | 一二三四五六七八九十一二三四五六七八九十…"* ]]
}
