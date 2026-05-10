#!/usr/bin/env bats
# Unit tests for: roll-idea skill (renamed from roll-jot)

@test "roll-idea SKILL.md exists" {
  [ -f "${BATS_TEST_DIRNAME}/../../skills/roll-idea/SKILL.md" ]
}

@test "roll-jot directory is removed (renamed to roll-idea)" {
  [ ! -d "${BATS_TEST_DIRNAME}/../../skills/roll-jot" ]
}

@test "roll-idea SKILL.md has name: roll-idea" {
  run bash -c "grep '^name: roll-idea' '${BATS_TEST_DIRNAME}/../../skills/roll-idea/SKILL.md'"
  [ "$status" -eq 0 ]
}

@test "roll-idea SKILL.md references roll-idea not roll-jot in trigger section" {
  run bash -c "grep 'roll-idea' '${BATS_TEST_DIRNAME}/../../skills/roll-idea/SKILL.md'"
  [ "$status" -eq 0 ]
}

@test "roll-build SKILL.md routes IDEA to roll-idea not roll-jot" {
  run bash -c "grep 'roll-idea' '${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md'"
  [ "$status" -eq 0 ]
}
