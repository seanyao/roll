#!/usr/bin/env bats
# US-AGENT-009: chain_depth ≥ 2 cap.
#
# When a story's chain_depth would become ≥ 2 after auto-split, refuse the
# re-split: flip 🚫 Hold + ALERT with the full chain history. Prevents
# infinite "agent can't do → split → agent can't do → split" loops.

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/features/test
  export ROLL_MAIN_PROJECT="$TEST_TMP"
  export _SHARED_ROOT="$TEST_TMP/shared"
  mkdir -p "$_SHARED_ROOT/loop"
  cat > .roll/backlog.md <<'MD'
| [US-TEST-100](.roll/features/test/t.md#us-test-100) | parent | 🔨 In Progress |
| [US-TEST-200](.roll/features/test/t.md#us-test-200) | depth-1 | 🔨 In Progress |
| [US-TEST-300](.roll/features/test/t.md#us-test-300) | depth-2 | 🔨 In Progress |
| [US-TEST-400](.roll/features/test/t.md#us-test-400) | depth-3 | 🔨 In Progress |
MD
  cat > .roll/features/test/t.md <<'MD'
<a id="us-test-100"></a>
## US-TEST-100 parent

**Agent profile:**
- est_min: 10
- risk_zone: low
- chain_depth: 0

<a id="us-test-200"></a>
## US-TEST-200 depth-1

**Agent profile:**
- est_min: 10
- risk_zone: low
- chain_depth: 1

<a id="us-test-300"></a>
## US-TEST-300 depth-2

**Agent profile:**
- est_min: 10
- risk_zone: low
- chain_depth: 2

<a id="us-test-400"></a>
## US-TEST-400 depth-3

**Agent profile:**
- est_min: 10
- risk_zone: low
- chain_depth: 3
MD
}

teardown() {
  cd /
  unset ROLL_MAIN_PROJECT _SHARED_ROOT
  rm -rf "$TEST_TMP"
}

@test "chain_depth_cap: depth 0 → exit 0 (split allowed)" {
  source "$ROLL"
  run _loop_chain_depth_cap_check US-TEST-100
  [ "$status" -eq 0 ]
}

@test "chain_depth_cap: depth 1 → exit 0 (split allowed, will become 2)" {
  source "$ROLL"
  run _loop_chain_depth_cap_check US-TEST-200
  [ "$status" -eq 0 ]
}

@test "chain_depth_cap: depth 2 → exit 1 (third auto-split refused)" {
  source "$ROLL"
  run _loop_chain_depth_cap_check US-TEST-300
  [ "$status" -ne 0 ]
}

@test "chain_depth_cap: depth 3 → exit 1 (also refused)" {
  source "$ROLL"
  run _loop_chain_depth_cap_check US-TEST-400
  [ "$status" -ne 0 ]
}

@test "chain_depth_cap: story without Agent profile → exit 0 (treated as depth 0)" {
  cat > .roll/features/test/t.md <<'MD'
<a id="us-test-500"></a>
## US-TEST-500 no profile
MD
  cat > .roll/backlog.md <<'MD'
| [US-TEST-500](.roll/features/test/t.md#us-test-500) | nope | 📋 Todo |
MD
  source "$ROLL"
  run _loop_chain_depth_cap_check US-TEST-500
  [ "$status" -eq 0 ]
}

@test "split_cap_hit: writes ALERT with chain depth + story id" {
  source "$ROLL"
  _loop_split_cap_hit US-TEST-300 "depth=2 exceeded"
  local alert_files
  alert_files=$(grep -lE 'StorySplitCapHit|cap-hit|chain_depth' "$_SHARED_ROOT/loop/"ALERT-*.md 2>/dev/null || true)
  [ -n "$alert_files" ]
}

@test "split_cap_hit: flips story to 🚫 Hold" {
  source "$ROLL"
  _loop_split_cap_hit US-TEST-300 "depth=2 exceeded"
  grep -E 'US-TEST-300.*🚫 Hold' .roll/backlog.md
}

@test "build/fix SKILLs reference chain_depth cap-hit path" {
  local build_skill="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"
  local fix_skill="${BATS_TEST_DIRNAME}/../../skills/roll-fix/SKILL.md"
  grep -qE 'chain_depth.*>= ?2|chain_depth.*≥.?2|US-AGENT-009|cap-hit' "$build_skill"
  grep -qE 'chain_depth.*>= ?2|chain_depth.*≥.?2|US-AGENT-009|cap-hit' "$fix_skill"
}
