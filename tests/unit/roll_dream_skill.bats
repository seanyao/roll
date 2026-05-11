#!/usr/bin/env bats
# Tests for roll-.dream SKILL.md output template (US-AUTO-017)
# Verifies dream log output is in Chinese to align with roll-brief style.

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-.dream/SKILL.md"

@test "roll-.dream SKILL.md: dream log heading uses Chinese 概要" {
  grep -qF '## 概要' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: dead code section uses Chinese 死代码" {
  grep -qF '## 死代码' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: drift section uses Chinese 架构漂移" {
  grep -qF '## 架构漂移' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: pruning section uses Chinese 裁剪候选" {
  grep -qF '## 裁剪候选' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: emerging patterns section uses Chinese 新兴模式" {
  grep -qF '## 新兴模式' "$SKILL_FILE"
}

@test "roll-.dream SKILL.md: REFACTOR entries section uses Chinese 创建的 REFACTOR 条目" {
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

@test "roll-.dream SKILL.md: summary line uses Chinese 扫描项 / 发现" {
  grep -qF '扫描项' "$SKILL_FILE"
  grep -qF '发现' "$SKILL_FILE"
}
