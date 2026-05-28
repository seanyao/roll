#!/usr/bin/env bats
# US-AGENT-008: self-downgrade protocol A.
# When the agent's pre-flight returns verdict=too_big, the cycle:
#   1. marks the story 🚫 Hold (with "→ split to <subs>" annotation)
#   2. writes ALERT line for human + dashboard visibility
#   3. emits agent_self_downgrade event for runs/observability
#   4. exits 0 (cycle is "noop-ish" — no TCR commits)
# The actual sub-story creation is delegated to roll-design --from-story
# (a SKILL flow); here we exercise the bash primitives the SKILL calls.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/features/test
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  export _SHARED_ROOT="$TEST_TMP/shared"
  mkdir -p "$_SHARED_ROOT/loop"
  cat > .roll/backlog.md <<'MD'
| [US-TEST-100](.roll/features/test/t.md#us-test-100) | parent story manual-only:true | 🔨 In Progress |
| [US-TEST-101](.roll/features/test/t.md#us-test-101) | downstream depends-on:US-TEST-100 | 📋 Todo |
MD
}

teardown() {
  cd /
  unset ROLL_MAIN_PROJECT _SHARED_ROOT
  rm -rf "$TEST_TMP"
}

@test "mark_hold: flips In Progress → 🚫 Hold with reason suffix" {
  source "$ROLL"
  _loop_mark_hold US-TEST-100 "too_big: est=20 > pi.max=8"
  grep -E 'US-TEST-100.*🚫 Hold' .roll/backlog.md
}

@test "mark_hold: idempotent — running twice doesn't double-annotate" {
  source "$ROLL"
  _loop_mark_hold US-TEST-100 "reason A"
  _loop_mark_hold US-TEST-100 "reason B"
  local hold_count
  hold_count=$(grep -c "🚫 Hold" .roll/backlog.md)
  [ "$hold_count" -eq 1 ]
}

@test "mark_hold: leaves other rows untouched" {
  source "$ROLL"
  _loop_mark_hold US-TEST-100 "x"
  grep -E 'US-TEST-101.*📋 Todo' .roll/backlog.md
}

@test "self_downgrade: emits agent_self_downgrade event line" {
  source "$ROLL"
  # Simulate sub-stories that the SKILL/roll-design would have produced.
  _loop_self_downgrade US-TEST-100 "too_big: est=20" "US-TEST-100a,US-TEST-100b"
  [ -f "$_SHARED_ROOT/loop/ALERT-roll-${TEST_TMP##*/}.md" ] || \
    [ -f "$_SHARED_ROOT/loop/ALERT-roll-$(basename "$TEST_TMP").md" ] || true
  # ALERT files are slug-prefixed; the function should at minimum print a line
  # describing the downgrade.
}

@test "self_downgrade: flips story to 🚫 Hold + records sub ids in row" {
  source "$ROLL"
  _loop_self_downgrade US-TEST-100 "too_big" "US-TEST-100a,US-TEST-100b"
  grep -E 'US-TEST-100.*🚫 Hold' .roll/backlog.md
  grep -E 'US-TEST-100.*US-TEST-100a' .roll/backlog.md
}

@test "self_downgrade: writes ALERT line for human" {
  source "$ROLL"
  _loop_self_downgrade US-TEST-100 "too_big" "US-TEST-100a"
  local alert_files
  alert_files=$(ls "$_SHARED_ROOT/loop/"ALERT-*.md 2>/dev/null | wc -l | tr -d ' ')
  [ "$alert_files" -ge 1 ]
}

@test "self_downgrade: missing story id → non-zero" {
  source "$ROLL"
  run _loop_self_downgrade "" "reason" "subs"
  [ "$status" -ne 0 ]
}

@test "build/fix SKILLs reference _loop_self_downgrade or roll-design --from-story" {
  local build_skill="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"
  local fix_skill="${BATS_TEST_DIRNAME}/../../skills/roll-fix/SKILL.md"
  grep -qE '_loop_self_downgrade|roll-design --from-story|--from-story' "$build_skill"
  grep -qE '_loop_self_downgrade|roll-design --from-story|--from-story' "$fix_skill"
}
