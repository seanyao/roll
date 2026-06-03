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
  # FIX-070: the flow used to commit "chore: mark US-XXX in progress" but
  # that commit was effectively empty because .roll/ is gitignored. Now the
  # flow calls _loop_mark_in_progress, which writes directly to main's
  # backlog without going through git.
  grep -qF '_loop_mark_in_progress' "$SKILL_FILE"
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

@test "roll-loop SKILL.md: Step 2 documents dependency gate (FIX-032)" {
  # Must mention the depends-on helper added in FIX-032 + how the loop uses it
  grep -qF '_loop_check_depends_on' "$SKILL_FILE"
  grep -qE 'depends-on|Dependency gate' "$SKILL_FILE"
  # On skip, must be logged to runs.jsonl as `skipped`
  grep -qE 'skipped.*depends-on|runs\.jsonl.*skipped' "$SKILL_FILE"
}

@test "roll-loop SKILL.md: pick_todo emit uses LOOP_CYCLE_ID as label (IDEA-028 follow-up)" {
  # When the loop skill picks a story, it must emit pick_todo with the cycle
  # id as label (not the US id). Dashboard aggregate() buckets events by
  # label; if US_ID is used the event lands in a "FIX-065" bucket separate
  # from the cycle bucket, and the cycle ends up "has tokens but no ID".
  grep -qF '_loop_event pick_todo "$LOOP_CYCLE_ID" "$US_ID"' "$SKILL_FILE"
  # And the prior wrong form must be gone.
  ! grep -qE '_loop_event story "\$US_ID"' "$SKILL_FILE"
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
