#!/usr/bin/env bats
# E2E for US-VIEW-011 golden path: dashboard renders the PR landing marker
# (#NN ✓ merged / #NN ↩ closed / #NN … open) after the story id in each
# cycle row, and uses ⊘ glyph for completed-but-closed (wasted) cycles.

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

setup() {
  TEST_TMP="$(mktemp -d)"
  mkdir -p "$TEST_TMP/loop"
  export ROLL_SHARED_ROOT="$TEST_TMP"
  cd "$TEST_TMP"
  git init -q
  git config user.email t@t.t
  git config user.name T
  mkdir -p .roll
  : > .roll/backlog.md
}

teardown() { rm -rf "${TEST_TMP:-}"; }

slug_for_cwd() {
  python3 -c "
import sys; sys.path.insert(0, '${LIB}')
import importlib.util
spec = importlib.util.spec_from_file_location('s', '${STATUS}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.project_slug('${TEST_TMP}'))
"
}

@test "E2E US-VIEW-011: merged cycle row shows #NN ✓ after story id" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  local ts1="2026-05-20T10:00:00Z"
  local ts2="2026-05-20T10:15:00Z"
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"LM","outcome":"ok","detail":""}
{"ts":"${ts1}","stage":"pick_todo","label":"LM","outcome":"ok","detail":"US-VIEW-011"}
{"ts":"${ts2}","stage":"pr","label":"LM","outcome":"open","detail":"https://github.com/x/y/pull/777"}
{"ts":"${ts2}","stage":"pr","label":"LM","outcome":"merged","detail":"https://github.com/x/y/pull/777"}
{"ts":"${ts2}","stage":"cycle_end","label":"LM","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  # `_STORY_ID_PAT` (`\b([A-Z]+-\d+)\b`) only captures the last `<UPPER>-<num>`
  # segment, so a story like `US-VIEW-011` renders as `VIEW-011` on every row.
  # That's a pre-existing renderer quirk worth fixing separately; this test
  # locks in the marker behavior, not the prefix strip.
  [[ "$output" == *"VIEW-011 #777 ✓"* ]]
}

@test "E2E US-VIEW-011: closed PR cycle row shows ⊘ glyph and #NN ↩ marker" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  local ts1="2026-05-20T11:00:00Z"
  local ts2="2026-05-20T11:15:00Z"
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"LC","outcome":"ok","detail":""}
{"ts":"${ts1}","stage":"pick_todo","label":"LC","outcome":"ok","detail":"US-VIEW-011"}
{"ts":"${ts2}","stage":"pr","label":"LC","outcome":"open","detail":"https://github.com/x/y/pull/888"}
{"ts":"${ts2}","stage":"pr","label":"LC","outcome":"closed","detail":"https://github.com/x/y/pull/888"}
{"ts":"${ts2}","stage":"cycle_end","label":"LC","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  [[ "$output" == *"#888 ↩"* ]]
  [[ "$output" == *"⊘"* ]]
}

@test "E2E US-VIEW-011: open PR (no terminal event) renders as #NN … (backward compat 'ok')" {
  local slug; slug=$(slug_for_cwd)
  local evfile="${ROLL_SHARED_ROOT}/loop/events-${slug}.ndjson"
  local ts1="2026-05-20T12:00:00Z"
  local ts2="2026-05-20T12:15:00Z"
  cat > "$evfile" <<EOF
{"ts":"${ts1}","stage":"cycle_start","label":"LO","outcome":"ok","detail":""}
{"ts":"${ts1}","stage":"pick_todo","label":"LO","outcome":"ok","detail":"US-VIEW-011"}
{"ts":"${ts2}","stage":"pr","label":"LO","outcome":"ok","detail":"https://github.com/x/y/pull/999"}
{"ts":"${ts2}","stage":"cycle_end","label":"LO","outcome":"done","detail":""}
EOF
  run env NO_COLOR=1 ROLL_SHARED_ROOT="$ROLL_SHARED_ROOT" python3 "$STATUS" --no-color --days 30
  [ "$status" -eq 0 ]
  [[ "$output" == *"#999 …"* ]]
}
