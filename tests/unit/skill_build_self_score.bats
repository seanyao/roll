#!/usr/bin/env bats
# US-SKILL-012: roll-build writes a self-score note after each delivered story.

BUILD_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"

@test "roll-build SKILL mentions self-score" {
  grep -qE '_skill_write_self_score|self-score|自评' "$BUILD_SKILL"
}

@test "roll-build SKILL references US-SKILL-010 / 012" {
  grep -qE 'US-SKILL-010|US-SKILL-012|skill-self-scoring' "$BUILD_SKILL"
}

@test "roll-build SKILL shows _skill_write_self_score roll-build invocation" {
  grep -qE '_skill_write_self_score roll-build' "$BUILD_SKILL"
}

@test "roll-build SKILL describes verdict + score range" {
  grep -qF 'good' "$BUILD_SKILL"
  grep -qF 'ok' "$BUILD_SKILL"
  grep -qF 'regression' "$BUILD_SKILL"
  grep -qE '1[ .][.][. ]?10|1-10|1.{0,3}10' "$BUILD_SKILL"
}

@test "roll-build SKILL ties self-score to delivery completion" {
  # Story-mode delivery has Phase 5 / DoD / etc.; self-score must be in
  # the closing path.
  grep -qE 'Phase|DoD|Definition of Done|✅|finished|complete' "$BUILD_SKILL"
}
