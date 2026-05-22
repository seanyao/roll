#!/usr/bin/env bats
# Tests for roll-design SKILL.md content invariants (US-AUTO-020)

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-design/SKILL.md"

@test "roll-design SKILL.md: Workflow Confirm gate clarifies No semantics" {
  # No must explicitly state the story is already written to BACKLOG as 📋 Todo
  grep -qE 'No.*📋 Todo|📋 Todo.*No' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Workflow Confirm gate notes loop will pick it up" {
  # The text must mention loop will run it on the next cycle
  grep -qE 'loop.*下轮|loop.*next cycle|下轮.*自动执行' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Workflow Confirm gate clarifies No only skips immediate execution" {
  grep -qE '仅跳过立即执行|只是跳过立即执行|skip.*immediate execution' "$SKILL_FILE"
}

# US-SKILL-009: Doc Update Discipline as a tasking convention

@test "roll-design SKILL.md: has Doc Update Discipline section" {
  grep -qF 'Doc Update Discipline' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Split into Stories step enforces doc-refresh story when user-visible behavior changes" {
  # Within the Split into Stories area, a mandatory doc-story rule must be present
  grep -qE '文档刷新|doc.*refresh|doc.*update.*story' "$SKILL_FILE"
}

@test "roll-design SKILL.md: doc-refresh discipline lists user-visible behavior triggers" {
  # Triggers: CLI 输出 / 命令参数 / 状态语义 / 错误提示
  grep -qF 'CLI 输出' "$SKILL_FILE"
  grep -qF '命令参数' "$SKILL_FILE"
  grep -qF '状态语义' "$SKILL_FILE"
  grep -qF '错误提示' "$SKILL_FILE"
}

@test "roll-design SKILL.md: doc-refresh discipline lists exemptions (内部重构 / 测试沙箱化)" {
  grep -qE '内部重构|纯内部' "$SKILL_FILE"
}

@test "roll-design SKILL.md: Story Format provides Phase X 收尾文档 story template" {
  grep -qE '收尾文档|Phase.*文档|doc-refresh story template' "$SKILL_FILE"
}

@test "roll-design SKILL.md: doc-refresh checklist includes guide / README / --help / 双语" {
  grep -qF 'guide' "$SKILL_FILE"
  grep -qF 'README' "$SKILL_FILE"
  grep -qF -e '--help' "$SKILL_FILE"
  grep -qE '双语|bilingual' "$SKILL_FILE"
}

@test "roll-design SKILL.md: doc-refresh discipline cites US-DECK-015 as a worked example" {
  grep -qF 'US-DECK-015' "$SKILL_FILE"
}

@test "roll-design SKILL.md: When to Use / Workflow surfaces doc-refresh discipline" {
  # Need a short bilingual mention near the top so users see it without scrolling
  grep -qE '文档刷新.*doc|doc.*文档刷新|doc-refresh|Doc-refresh' "$SKILL_FILE"
}
