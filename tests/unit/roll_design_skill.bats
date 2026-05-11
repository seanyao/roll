#!/usr/bin/env bats
# Tests for roll-design SKILL.md content invariants (US-AUTO-020)

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-design/SKILL.md"

@test "roll-design SKILL.md: Workflow Confirm gate clarifies No semantics" {
  # No must explicitly state the story is already written to BACKLOG as 📋 Todo
  grep -qE 'No.*📋 Todo|📋 Todo.*No' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Workflow Confirm gate notes loop will pick it up" {
  # The text must mention loop will run it on the next cycle
  grep -qE 'loop.*下轮|loop.*next cycle|下轮.*自动执行' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Workflow Confirm gate clarifies No only skips immediate execution" {
  grep -qE '仅跳过立即执行|只是跳过立即执行|skip.*immediate execution' "$SKILL_FILE"
}
