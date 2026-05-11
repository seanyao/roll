#!/usr/bin/env bats
# Tests for roll-loop SKILL.md content invariants (US-AUTO-022)

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-loop/SKILL.md"

@test "roll-loop SKILL.md: instructs to skip rows with 🔨 In Progress" {
  grep -qF '🔨 In Progress' "$SKILL_FILE"
  grep -qE 'skip|Skip' "$SKILL_FILE"
}

@test "roll-loop SKILL.md: documents concurrency safety / LOCK semantics" {
  grep -qF 'Concurrency Safety' "$SKILL_FILE"
  grep -qF '.LOCK-' "$SKILL_FILE"
}

@test "roll-loop SKILL.md: Step 3 marks story 🔨 In Progress before invoking executor" {
  grep -qF '🔨 In Progress' "$SKILL_FILE"
  grep -qE 'chore: mark.*in.progress' "$SKILL_FILE"
}

@test "roll-loop SKILL.md: Step 1 recovers orphan 🔨 entries on startup" {
  grep -qF 'orphan' "$SKILL_FILE"
  grep -qF 'ALERT' "$SKILL_FILE"
  # Orphan recovery must reference both 🔨 status and state.yaml cross-check
  grep -qE 'orphan.*🔨|🔨.*orphan' "$SKILL_FILE"
}
