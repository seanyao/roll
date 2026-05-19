#!/usr/bin/env bats
# E2E golden path for US-DOC-004: project root has no stray docs *.md files
# (post-Phase-1: docs/ removed, guide/ and site/ are root-level products,
# process artifacts live in .roll/)

REPO_ROOT="${BATS_TEST_DIRNAME}/../../"

@test "e2e: docs/ directory removed after Phase 1 migration" {
  # After Phase 1, docs/ should not exist at all (process moved to .roll/,
  # user-facing moved to guide/ + site/).
  [ ! -d "${REPO_ROOT}/docs" ] || {
    # Tolerate .DS_Store-only remnants on macOS dev hosts
    stray=$(find "${REPO_ROOT}/docs" -type f ! -name '.DS_Store' 2>/dev/null)
    [ -z "$stray" ]
  }
}

@test "e2e: guide/en/ has methodology, skills, plus original 4 guides" {
  [ -f "${REPO_ROOT}/guide/en/overview.md" ]
  [ -f "${REPO_ROOT}/guide/en/loop.md" ]
  [ -f "${REPO_ROOT}/guide/en/dream.md" ]
  [ -f "${REPO_ROOT}/guide/en/peer.md" ]
  [ -f "${REPO_ROOT}/guide/en/methodology.md" ]
  [ -f "${REPO_ROOT}/guide/en/skills.md" ]
}

@test "e2e: guide/zh/ has methodology, skills, plus original 4 guides" {
  [ -f "${REPO_ROOT}/guide/zh/overview.md" ]
  [ -f "${REPO_ROOT}/guide/zh/loop.md" ]
  [ -f "${REPO_ROOT}/guide/zh/dream.md" ]
  [ -f "${REPO_ROOT}/guide/zh/peer.md" ]
  [ -f "${REPO_ROOT}/guide/zh/methodology.md" ]
  [ -f "${REPO_ROOT}/guide/zh/skills.md" ]
}

@test "changelog SKILL.md Section 8.4 contains planning distinction rule" {
  local skill="${BATS_TEST_DIRNAME}/../../skills/roll-.changelog/SKILL.md"
  grep -q "规划中" "$skill"
}
