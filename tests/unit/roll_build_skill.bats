#!/usr/bin/env bats
# Tests for executor SKILL.md content invariants (US-AUTO-016)
# Both roll-build and roll-fix must accept 🔨 In Progress as a valid prior
# state for the ✅ Done transition (loop marks 🔨 before invoking).

BUILD_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"
FIX_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-fix/SKILL.md"

@test "roll-build SKILL.md: status transition accepts 🔨 In Progress as prior state" {
  grep -qF '🔨 In Progress' "$BUILD_SKILL"
  grep -qE '📋 Todo.*or.*🔨|🔨.*or.*📋' "$BUILD_SKILL"
}

@test "roll-fix SKILL.md: status transition accepts 🔨 In Progress as prior state" {
  grep -qF '🔨 In Progress' "$FIX_SKILL"
  grep -qE '📋 Todo.*or.*🔨|🔨.*or.*📋' "$FIX_SKILL"
}

@test "roll-brief SKILL.md: surfaces in-progress items in dedicated section" {
  local brief_skill="${BATS_TEST_DIRNAME}/../../skills/roll-brief/SKILL.md"
  grep -qF '🔨' "$brief_skill"
  grep -qF '进行中' "$brief_skill"
}
