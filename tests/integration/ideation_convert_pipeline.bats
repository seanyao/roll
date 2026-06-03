#!/usr/bin/env bats
# US-AUTO-048: ideation convert golden-path integration test.
# Verifies the full pipeline: _loop_ideation_scan → _loop_ideation_convert
# against a realistic backlog with mixed IDEA rows.

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP="$(mktemp -d)"
  PROJ="${TEST_TMP}/proj"
  mkdir -p "${PROJ}/.roll/loop"
  # Minimal realistic backlog with unconverted IDEAs
  cat > "${PROJ}/.roll/backlog.md" <<'MD'
## Epic: Test

| [IDEA-100](.roll/features/test/t.md#idea-100) | 大范围重构核心模块 | 📋 Todo |
| [IDEA-101](.roll/features/test/t.md#idea-101) | 修复一个小bug | 📋 Todo |
| [IDEA-102](.roll/features/test/t.md#idea-102) | 改进用户反馈流程 | 📋 Todo |
| [IDEA-103](.roll/features/test/t.md#idea-103) | 已转换的故事 | ✅ 已转 US-AUTO-100 |
MD
  source "$ROLL_BIN"
}
teardown() { rm -rf "${TEST_TMP:-}"; }

@test "ideation pipeline: scan → convert routes correctly" {
  cd "$PROJ"
  ROLL_MAIN_PROJECT="$PROJ"

  # Step 1: scan
  local candidates
  candidates=$(_loop_ideation_scan "${PROJ}/.roll/backlog.md" 10)
  [ -n "$candidates" ]
  [ "$candidates" != "[]" ]

  # IDEA-100 should be manual (high risk)
  [[ "$candidates" == *'"id":"IDEA-100"'* ]]
  [[ "$candidates" == *'"verdict":"manual"'* ]]

  # IDEA-101 should be candidate (simple)
  [[ "$candidates" == *'"id":"IDEA-101"'* ]]
  [[ "$candidates" == *'"verdict":"candidate"'* ]]
  [[ "$candidates" == *'"peer":false'* ]]

  # IDEA-102 should be candidate with peer (borderline)
  [[ "$candidates" == *'"id":"IDEA-102"'* ]]
  [[ "$candidates" == *'"verdict":"candidate"'* ]]
  [[ "$candidates" == *'"peer":true'* ]]

  # IDEA-103 should NOT be present (already converted)
  [[ "$candidates" != *'IDEA-103'* ]]

  # Step 2: convert routes to correct hooks
  local result
  result=$(_loop_ideation_convert "$candidates")
  # Manual → skip
  [[ "$result" == *'skip IDEA-100'* ]]
  # Simple → direct
  [[ "$result" == *'plan: Skill(roll-design, --from-idea IDEA-101)'* ]]
  # Borderline → peer
  [[ "$result" == *'plan: Skill(roll-peer, IDEA-102)'* ]]
}

@test "ideation pipeline: marking helpers work on real backlog" {
  cd "$PROJ"
  ROLL_MAIN_PROJECT="$PROJ"

  # Mark IDEA-100 as converting
  _loop_ideation_mark_converting "IDEA-100"
  grep -q '🔨 Converting' "${PROJ}/.roll/backlog.md"
  grep -q 'IDEA-100' "${PROJ}/.roll/backlog.md"

  # Mark IDEA-101 as peer review
  _loop_ideation_mark_peer "IDEA-101"
  grep -q '🔍 Peer Review' "${PROJ}/.roll/backlog.md"

  # Mark IDEA-100 as done (converted to US)
  _loop_ideation_mark_done "IDEA-100" "US-AUTO-200"
  grep -q '✅ 已转 US-AUTO-200' "${PROJ}/.roll/backlog.md"
}
