#!/usr/bin/env bats
# Tests for executor tool-scope declarations (FIX-149)
# The two most-run executors (roll-build / roll-fix) must declare allowed-tools
# in their SKILL.md frontmatter, matching the convention of the other skills.
# Note: for roll this is declaration + lint; tool enforcement lives in the
# inner agent harness, not in roll.

BUILD_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"
FIX_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-fix/SKILL.md"

@test "roll-build SKILL.md: frontmatter declares allowed-tools" {
  grep -qE '^allowed-tools: ' "$BUILD_SKILL"
}

@test "roll-fix SKILL.md: frontmatter declares allowed-tools" {
  grep -qE '^allowed-tools: ' "$FIX_SKILL"
}

@test "roll-build allowed-tools: covers core delivery tools" {
  line="$(grep -E '^allowed-tools: ' "$BUILD_SKILL")"
  for tool in Read Edit Write Bash Skill Agent; do
    echo "$line" | grep -qF "$tool" || {
      echo "roll-build allowed-tools missing: $tool"
      return 1
    }
  done
}

@test "roll-fix allowed-tools: covers core delivery tools" {
  line="$(grep -E '^allowed-tools: ' "$FIX_SKILL")"
  for tool in Read Edit Write Bash Skill; do
    echo "$line" | grep -qF "$tool" || {
      echo "roll-fix allowed-tools missing: $tool"
      return 1
    }
  done
}

@test "executor skills (roll-build, roll-fix) declare allowed-tools (anti-drift)" {
  # Both core executors must keep their declaration; guards against regression.
  missing=""
  for f in "$BUILD_SKILL" "$FIX_SKILL"; do
    grep -qE '^allowed-tools: ' "$f" || missing="$missing $f"
  done
  [ -z "$missing" ] || {
    echo "executor skills missing allowed-tools:$missing"
    return 1
  }
}
