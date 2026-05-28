#!/usr/bin/env bats
# US-AGENT-001: roll-design Story Format must carry an Agent profile block
# so loop routing (US-AGENT-004) can read est_min / risk_zone per story.

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-design/SKILL.md"

@test "roll-design SKILL.md: Story Format template includes Agent profile block" {
  grep -qF '**Agent profile:**' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Agent profile names est_min" {
  grep -qE 'est_min' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Agent profile names risk_zone" {
  grep -qE 'risk_zone' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Agent profile names chain_depth" {
  grep -qE 'chain_depth' "$SKILL_FILE"
}

@test "roll-design SKILL.md: risk_zone enumerates low / medium / high" {
  grep -qE 'low.*medium.*high|low / medium / high' "$SKILL_FILE"
}

@test "roll-design SKILL.md: est_min bounded 1-30 (cycle granularity)" {
  # 5-10 min target per feedback_story_granularity_ai_cycle, max 30 as hard ceiling
  grep -qE 'est_min.*1[ -]*30|est_min.*整数' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Split step requires filling Agent profile" {
  # Either explicit MUST/必须 close to "Agent profile" or the Step 4 split mentioning it
  grep -qE 'Agent profile.*必须|必须.*Agent profile|Agent profile.*MUST|MUST.*Agent profile' "$SKILL_FILE"
}
