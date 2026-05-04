#!/usr/bin/env bats
# Unit tests for: roll-doctor skill

@test "roll-doctor SKILL.md exists" {
  [ -f "${BATS_TEST_DIRNAME}/../../skills/roll-doctor/SKILL.md" ]
}

@test "roll-doctor SKILL.md has valid YAML frontmatter" {
  local frontmatter
  frontmatter=$(head -5 "${BATS_TEST_DIRNAME}/../../skills/roll-doctor/SKILL.md")
  echo "$frontmatter" | grep -q '^name:'
  echo "$frontmatter" | grep -q '^description:'
}

@test "roll-doctor SKILL.md has name field" {
  run bash -c "grep '^name: roll-doctor' '${BATS_TEST_DIRNAME}/../../skills/roll-doctor/SKILL.md'"
  [ "$status" -eq 0 ]
}
