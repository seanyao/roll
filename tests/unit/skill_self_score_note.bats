#!/usr/bin/env bats
# US-SKILL-010: unified self-score note format for roll-build /
# roll-fix / roll-design.
#
# Helper:
#   _skill_write_self_score <skill> <story_id> <score:int> <verdict> [rationale]
# Writes: .roll/notes/<YYYY-MM-DD>-<skill>-<story_id>.md
# Format:
#   ---
#   skill: roll-build
#   story: US-XXX-NNN
#   score: 8
#   verdict: good
#   ts: 2026-05-29T03:00:00Z
#   ---
#   <rationale body>

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll
}

teardown() { cd /; rm -rf "$TEST_TMP"; }

@test "helper: writes note to .roll/notes/<date>-<skill>-<story>.md" {
  source "$ROLL"
  _skill_write_self_score roll-build US-FOO-001 8 good "tests passed and feature delivered"
  ls .roll/notes/*roll-build*US-FOO-001*.md > /dev/null
}

@test "FIX-176: invoked from inside .roll/ does not double-nest (.roll/.roll/notes)" {
  source "$ROLL"
  cd .roll
  _skill_write_self_score roll-design US-BAR-002 7 good "self-score run from inside .roll"
  # Note lands in .roll/notes (here: cwd/notes), never .roll/.roll/notes
  [ ! -d ".roll/notes" ]
  ls notes/*roll-design*US-BAR-002*.md > /dev/null
}

@test "helper: note contains valid YAML frontmatter" {
  source "$ROLL"
  _skill_write_self_score roll-build US-FOO-001 8 good "rationale"
  local file; file=$(ls .roll/notes/*.md | head -1)
  head -1 "$file" | grep -qF -- "---"
  grep -qE "^skill: roll-build" "$file"
  grep -qE "^story: US-FOO-001" "$file"
  grep -qE "^score: 8" "$file"
  grep -qE "^verdict: good" "$file"
  grep -qE "^ts: " "$file"
}

@test "helper: rationale lands after frontmatter close" {
  source "$ROLL"
  _skill_write_self_score roll-build US-FOO-001 7 ok "ship-shape with caveats"
  local file; file=$(ls .roll/notes/*.md | head -1)
  grep -qF "ship-shape with caveats" "$file"
}

@test "helper: score out of 1-10 range rejected" {
  source "$ROLL"
  run _skill_write_self_score roll-build US-FOO-001 11 good "x"
  [ "$status" -ne 0 ]
  run _skill_write_self_score roll-build US-FOO-001 0 good "x"
  [ "$status" -ne 0 ]
}

@test "helper: invalid verdict rejected (only good/ok/regression allowed)" {
  source "$ROLL"
  run _skill_write_self_score roll-build US-FOO-001 8 alien "x"
  [ "$status" -ne 0 ]
}

@test "helper: missing skill name rejected" {
  source "$ROLL"
  run _skill_write_self_score "" US-FOO-001 8 good "x"
  [ "$status" -ne 0 ]
}

@test "helper: multiple scores for same story are kept as separate files" {
  source "$ROLL"
  _skill_write_self_score roll-build US-FOO-001 8 good "first"
  sleep 1
  _skill_write_self_score roll-build US-FOO-001 9 good "second"
  local count
  count=$(ls .roll/notes/*US-FOO-001*.md | wc -l | tr -d ' ')
  [ "$count" -eq 2 ]
}

@test "helper: works for roll-fix" {
  source "$ROLL"
  _skill_write_self_score roll-fix FIX-001 9 good "clean revert needed"
  ls .roll/notes/*roll-fix*FIX-001*.md > /dev/null
}

@test "helper: works for roll-design" {
  source "$ROLL"
  _skill_write_self_score roll-design US-FOO-002 8 good "story split looked balanced"
  ls .roll/notes/*roll-design*US-FOO-002*.md > /dev/null
}

@test "helper: invalid skill rejected (only roll-build/roll-fix/roll-design allowed)" {
  source "$ROLL"
  run _skill_write_self_score roll-bogus US-FOO-001 8 good "x"
  [ "$status" -ne 0 ]
}
