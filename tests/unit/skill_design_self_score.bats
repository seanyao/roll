#!/usr/bin/env bats
# US-SKILL-013: roll-design writes a self-score note after each design / split.

DESIGN_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-design/SKILL.md"

@test "roll-design SKILL mentions self-score" {
  grep -qE '_skill_write_self_score|self-score|自评' "$DESIGN_SKILL"
}

@test "roll-design SKILL references US-SKILL-010 / 013" {
  grep -qE 'US-SKILL-010|US-SKILL-013|skill-self-scoring' "$DESIGN_SKILL"
}

@test "roll-design SKILL shows _skill_write_self_score roll-design invocation" {
  grep -qE '_skill_write_self_score roll-design' "$DESIGN_SKILL"
}

@test "roll-design SKILL describes verdict + score range" {
  grep -qF 'good' "$DESIGN_SKILL"
  grep -qF 'ok' "$DESIGN_SKILL"
  grep -qF 'regression' "$DESIGN_SKILL"
  grep -qE '1[ .][.][. ]?10|1-10|1.{0,3}10' "$DESIGN_SKILL"
}

@test "roll-design SKILL ties self-score to a closing step (after BACKLOG write)" {
  grep -qE 'closing|Step 5|after.*backlog|complete' "$DESIGN_SKILL"
}
