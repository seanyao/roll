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

@test "roll-loop SKILL.md: Execution Boundary documents human bypass path (US-AUTO-020)" {
  # The Execution Boundary section must explain that humans can run $roll-build / $roll-fix directly
  grep -qE 'Execution Boundary' "$SKILL_FILE"
  grep -qE '任何时刻.*\$roll-build|directly.*\$roll-build|绕过 loop' "$SKILL_FILE"
  # Must mention emergency / interrupt scenarios so the why is obvious
  grep -qE '紧急|emergency|中断插入|interrupt' "$SKILL_FILE"
}

@test "roll-loop SKILL.md: runs.jsonl schema is strictly defined (FIX-018)" {
  # Strict schema warning must be present
  grep -qF 'Strict schema contract' "$SKILL_FILE"
  # status enum locked, synonyms forbidden
  grep -qF 'No synonyms' "$SKILL_FILE"
  # ts must be UTC Z (not local timezone)
  grep -qE 'UTC.*Z|Z suffix' "$SKILL_FILE"
  # alerts must be array of strings (not number)
  grep -qE 'alerts.*array|Always array, never number' "$SKILL_FILE"
  # project must be slug (not full path)
  grep -qE 'project.*slug|slug.*NOT the absolute path' "$SKILL_FILE"
  # no extra fields allowed — note/comment/details/info forbidden
  grep -qF 'No extra fields' "$SKILL_FILE"
  grep -qE 'note.*comment.*details|do not add `note`' "$SKILL_FILE"
}
