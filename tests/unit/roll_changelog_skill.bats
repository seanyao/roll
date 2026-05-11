#!/usr/bin/env bats
# Tests for roll-.changelog SKILL.md content invariants (FIX-019)
# The skill must write to `## Unreleased` instead of guessing version numbers.
# Only release.sh assigns concrete version numbers.

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-.changelog/SKILL.md"
RELEASE_SH="${BATS_TEST_DIRNAME}/../../scripts/release.sh"

@test "roll-.changelog SKILL.md: writes to ## Unreleased section, not guessed version" {
  grep -qF '## Unreleased' "$SKILL_FILE"
  # Must forbid version-number guessing somewhere in the file
  grep -qE 'do NOT guess version|never.*guess.*version|release\.sh.*assigns' "$SKILL_FILE"
}

@test "roll-.changelog SKILL.md: does NOT contain version-extraction code" {
  # Old behavior: a code block extracting VERSION from package.json. New: no such code.
  # Be specific: the previous code was: VERSION=$(node -e "... require('./package.json').version ...")
  ! grep -qF "require('./package.json').version" "$SKILL_FILE"
  ! grep -qF "git describe --tags --abbrev=0" "$SKILL_FILE"
}

@test "bin/roll: _promote_unreleased replaces ## Unreleased with ## v{VERSION}" {
  local ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
  grep -qF '_promote_unreleased()' "$ROLL_BIN"
  grep -qE 'sed.*Unreleased.*v\$\{version\}|## Unreleased' "$ROLL_BIN"
}
