#!/usr/bin/env bats
# Tests for US-DOC-004: migrate scattered docs into new structure

GUIDE_EN="${BATS_TEST_DIRNAME}/../../docs/guide/en"
GUIDE_ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh"
PRACTICES="${BATS_TEST_DIRNAME}/../../docs/practices"
DOCS="${BATS_TEST_DIRNAME}/../../docs"

# ─── New target locations exist ──────────────────────────────────────────────

@test "docs/guide/en/methodology.md exists" {
  [ -f "${GUIDE_EN}/methodology.md" ]
}

@test "docs/guide/zh/methodology.md exists" {
  [ -f "${GUIDE_ZH}/methodology.md" ]
}

@test "docs/guide/en/skills.md exists" {
  [ -f "${GUIDE_EN}/skills.md" ]
}

@test "docs/guide/zh/skills.md exists" {
  [ -f "${GUIDE_ZH}/skills.md" ]
}

@test "docs/practices/loop-autorun-verification.md exists" {
  [ -f "${PRACTICES}/loop-autorun-verification.md" ]
}

# ─── Old locations removed ────────────────────────────────────────────────────

@test "docs/methodology.md is removed (migrated)" {
  [ ! -f "${DOCS}/methodology.md" ]
}

@test "docs/methodology-en.md is removed (migrated)" {
  [ ! -f "${DOCS}/methodology-en.md" ]
}

@test "docs/skill-selection-guide.md is removed (migrated)" {
  [ ! -f "${DOCS}/skill-selection-guide.md" ]
}

@test "docs/loop-autorun-verification.md is removed (migrated)" {
  [ ! -f "${DOCS}/loop-autorun-verification.md" ]
}

# ─── Content validation ───────────────────────────────────────────────────────

@test "EN methodology covers three-loop architecture" {
  grep -qiE "three.*(loop|interlocking)|loop.*a.*loop.*b.*loop.*c" "${GUIDE_EN}/methodology.md"
}

@test "ZH methodology covers 3-layer engineering loop" {
  grep -qF "三层" "${GUIDE_ZH}/methodology.md"
}

@test "EN skills.md has roll-build entry" {
  grep -qF 'roll-build' "${GUIDE_EN}/skills.md"
}

@test "ZH skills.md has Chinese content" {
  grep -qE "帮我|做|修|实现|构建" "${GUIDE_ZH}/skills.md"
}

@test "practices/loop-autorun-verification.md documents verification trail" {
  grep -qiE "verification.*trail|trail|run.*time|schedule" "${PRACTICES}/loop-autorun-verification.md"
}
