#!/usr/bin/env bats
# US-SKILL-011: roll-fix SKILL instructs the agent to write a self-score
# note after each completed fix.

FIX_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-fix/SKILL.md"

@test "roll-fix SKILL mentions self-score helper" {
  grep -qE '_skill_write_self_score|self-score|自评' "$FIX_SKILL"
}

@test "roll-fix SKILL references US-SKILL-010 / 011 anchor for traceability" {
  grep -qE 'US-SKILL-010|US-SKILL-011|skill-self-scoring' "$FIX_SKILL"
}

@test "roll-fix SKILL shows the exact helper invocation pattern" {
  grep -qE '_skill_write_self_score roll-fix' "$FIX_SKILL"
}

@test "roll-fix SKILL ties self-score to a DoD / closing step" {
  # The self-score note must be referenced from the closing step of the fix
  # (Definition of Done or similar) so the AI emits it before exiting.
  grep -qE 'Definition of Done|✅|closing|收尾|完成时' "$FIX_SKILL"
}

@test "roll-fix SKILL describes verdict values (good / ok / regression)" {
  grep -qF 'good' "$FIX_SKILL"
  grep -qF 'ok' "$FIX_SKILL"
  grep -qF 'regression' "$FIX_SKILL"
}

@test "roll-fix SKILL describes score range 1..10" {
  grep -qE '1[ .][.][. ]?10|1-10|1.{0,3}10' "$FIX_SKILL"
}
