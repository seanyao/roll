#!/usr/bin/env bats
# Tests for roll-.dream SKILL.md output template (US-AUTO-017)
# Verifies dream log output is in Chinese to align with roll-brief style.

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-.dream/SKILL.md"

@test "roll-.dream SKILL.md: dream log heading uses Chinese" {
  grep -qF '## 概要' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: dead code section uses Chinese" {
  grep -qF '## 死代码' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: drift section uses Chinese" {
  grep -qF '## 架构漂移' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: pruning section uses Chinese" {
  grep -qF '## 裁剪候选' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: emerging patterns section uses Chinese" {
  grep -qF '## 新兴模式' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: REFACTOR entries section uses Chinese" {
  grep -qF '## 创建的 REFACTOR 条目' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: empty-state placeholders are in Chinese" {
  # At least the "未发现" pattern must appear for empty sections
  grep -qF '未发现' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: partial-status header is in Chinese" {
  grep -qE '## 状态[：:]\s*部分完成|状态.*部分' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: no longer ships English Dead Code / Architectural Drift section headers" {
  ! grep -qE '^## (Dead Code|Architectural Drift|Pruning Candidates|Emerging Patterns|REFACTOR Entries Created)$' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: summary line uses Chinese" {
  grep -qF '扫描项' "$SKILL_FILE"
  grep -qF '发现' "$SKILL_FILE"
}

# US-AUTO-018: explicit commit step in Output section
@test "roll-.dream SKILL.md: Output section has Commit subsection" {
  grep -qE '^### Commit' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: stages BACKLOG and dream log in same git add" {
  grep -qF 'git add .roll/backlog.md .roll/dream/YYYY-MM-DD.md' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: commit message for findings — chore: dream scan + N REFACTOR entries" {
  grep -qF 'chore: dream scan YYYY-MM-DD — {N} REFACTOR entries' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: commit message for no findings — chore: dream scan + no findings" {
  grep -qF 'chore: dream scan YYYY-MM-DD — no findings' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: rule — same-commit invariant for BACKLOG + dream log" {
  grep -qE '同一个 commit|同一 commit|single commit' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: rule — do not commit when write fails" {
  grep -qE '写文件失败时.*不.*commit|写入失败.*不.*commit' "$SKILL_FILE"
}
