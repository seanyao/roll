#!/usr/bin/env bats
# Tests for roll-brief SKILL.md commit step (US-AUTO-018)
# Verifies brief output is committed automatically after writing the file.

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-brief/SKILL.md"

@test "roll-brief SKILL.md: explicit commit step exists" {
  grep -qE '^### Step 4\.5 — Commit Brief' "$SKILL_FILE"
}

@test "roll-brief SKILL.md: stages the brief file with git add" {
  grep -qF 'git add .roll/briefs/YYYY-MM-DD-' "$SKILL_FILE"
}

@test "roll-brief SKILL.md: commit message uses docs: prefix with file id and reason" {
  grep -qF 'git commit -m "docs: roll-brief YYYY-MM-DD-' "$SKILL_FILE"
}

@test "roll-brief SKILL.md: rule — do not commit when write fails" {
  grep -qE '写文件失败时.*不.*commit|写入失败.*不.*commit' "$SKILL_FILE"
}

@test "roll-brief SKILL.md: allowed-tools still includes Bash(git:*)" {
  grep -qF 'Bash(git:*)' "$SKILL_FILE"
}
