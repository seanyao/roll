#!/usr/bin/env bats
# Tests for US-DOC-005: README refactor + AGENTS.md Documentation Conventions

ROOT="${BATS_TEST_DIRNAME}/../.."

# ─── README.md constraints ───────────────────────────────────────────────────

@test "README.md is at most 200 lines" {
  count=$(wc -l < "${ROOT}/README.md")
  [ "$count" -le 200 ]
}

@test "README.md contains one-sentence Roll definition" {
  grep -qiE "roll is|roll —|what is roll|roll solves|instruction.*workflow|framework.*ai" "${ROOT}/README.md"
}

@test "README.md has Documentation Index section" {
  grep -qiE "documentation index|doc index|## docs|## documentation" "${ROOT}/README.md"
}

@test "README.md links to guide/en/ files" {
  grep -qF 'guide/en/' "${ROOT}/README.md"
}

# ─── README_CN.md constraints ────────────────────────────────────────────────

@test "README_CN.md is at most 200 lines" {
  count=$(wc -l < "${ROOT}/README_CN.md")
  [ "$count" -le 200 ]
}

@test "README_CN.md has Chinese Documentation Index section" {
  grep -qiE "文档|docs" "${ROOT}/README_CN.md"
}

@test "README_CN.md links to guide/zh/ files" {
  grep -qF 'guide/zh/' "${ROOT}/README_CN.md"
}

# ─── AGENTS.md Documentation Conventions ────────────────────────────────────

@test "AGENTS.md has Documentation Conventions section" {
  grep -qiE "## .*documentation.*conventions|## .*文档.*规范" "${ROOT}/AGENTS.md"
}

@test "AGENTS.md Documentation Conventions mentions guide/en and guide/zh" {
  grep -qF 'guide/en' "${ROOT}/AGENTS.md"
  grep -qF 'guide/zh' "${ROOT}/AGENTS.md"
}

@test "AGENTS.md does not link to removed docs/methodology.md" {
  ! grep -qF 'docs/methodology.md' "${ROOT}/AGENTS.md"
}

@test "AGENTS.md does not link to removed docs/skill-selection-guide.md" {
  ! grep -qF 'docs/skill-selection-guide.md' "${ROOT}/AGENTS.md"
}
