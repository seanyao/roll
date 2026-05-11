#!/usr/bin/env bats
# Tests for US-DOC-006: roll-.dream doc coverage check + roll-brief doc coverage block

DREAM_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-.dream/SKILL.md"
BRIEF_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-brief/SKILL.md"

# ─── roll-.dream: Doc Coverage Check ─────────────────────────────────────────

@test "roll-.dream SKILL.md has Doc Coverage Check scan" {
  grep -qiE "doc.*coverage|coverage.*check|文档.*覆盖" "${DREAM_SKILL}"
}

@test "roll-.dream scans BACKLOG for Done stories vs guide/en/ docs" {
  grep -qiE "backlog.*guide/en|guide/en.*backlog|done.*guide|guide.*done" "${DREAM_SKILL}"
}

@test "roll-.dream scans guide/en/ for missing guide/zh/ translations" {
  grep -qF 'guide/en' "${DREAM_SKILL}"
  grep -qF 'guide/zh' "${DREAM_SKILL}"
}

@test "roll-.dream checks docs/ root for stray files" {
  grep -qiE "docs/.*root|stray|散落|根目录" "${DREAM_SKILL}"
}

@test "roll-.dream REFACTOR format uses 'docs:' prefix and 'flagged by dream'" {
  grep -qiE "docs:.*flagged by dream|flagged by dream" "${DREAM_SKILL}"
}

# ─── roll-brief: Doc Coverage block ──────────────────────────────────────────

@test "roll-brief SKILL.md has Doc Coverage section" {
  grep -qiE "doc.*coverage|文档.*覆盖|覆盖率" "${BRIEF_SKILL}"
}

@test "roll-brief shows guide/en coverage rate" {
  grep -qiE "guide/en.*coverage|coverage.*guide/en|EN.*覆盖|覆盖.*EN|guide/en" "${BRIEF_SKILL}"
}

@test "roll-brief shows guide/zh translation rate" {
  grep -qiE "guide/zh.*translat|ZH.*翻译率|翻译.*ZH|guide/zh" "${BRIEF_SKILL}"
}
