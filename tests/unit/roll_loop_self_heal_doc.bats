#!/usr/bin/env bats
# REFACTOR-024: CI self-heal flow in roll-loop SKILL.md was a 3-level nested
# ASCII tree — hard to scan. Replaced with two parallel numbered sub-flows
# ("Path A: allowed" / "Path B: exhausted") for readability.
# Also removes stale heal/.count file reference (superseded by REFACTOR-023).

LOOP_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"

@test "CI self-heal section uses Path A / Path B structure" {
  grep -qiE 'Path A|path a' "$LOOP_SKILL"
  grep -qiE 'Path B|path b' "$LOOP_SKILL"
}

@test "Path A describes the allowed / counter-incremented case" {
  grep -qiE 'allowed|counter.*increment|permit' "$LOOP_SKILL"
}

@test "Path B describes the exhausted / disabled case" {
  grep -qiE 'exhausted|disabled|ROLL_LOOP_NO_HEAL' "$LOOP_SKILL"
}

@test "stale heal/.count file path reference is removed" {
  ! grep -qF 'heal/<story_id>.count' "$LOOP_SKILL"
}

@test "CI self-heal section does not use the old nested tree style (no triple-pipe indent)" {
  ! grep -qF '│   1.' "$LOOP_SKILL"
}
