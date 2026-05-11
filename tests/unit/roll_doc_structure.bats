#!/usr/bin/env bats
# E2E golden path for US-DOC-004: docs/ root has no stray .md files

DOCS="${BATS_TEST_DIRNAME}/../../docs"

@test "e2e: docs/ root has no stray .md files outside allowed subdirs" {
  # Allowed subdirs: briefs/ dream/ guide/ domain/ features/ practices/
  stray=$(find "$DOCS" -maxdepth 1 -name '*.md' 2>/dev/null)
  [ -z "$stray" ]
}

@test "e2e: docs/guide/en/ has methodology, skills, plus original 4 guides" {
  [ -f "${DOCS}/guide/en/overview.md" ]
  [ -f "${DOCS}/guide/en/loop.md" ]
  [ -f "${DOCS}/guide/en/dream.md" ]
  [ -f "${DOCS}/guide/en/peer.md" ]
  [ -f "${DOCS}/guide/en/methodology.md" ]
  [ -f "${DOCS}/guide/en/skills.md" ]
}

@test "e2e: docs/guide/zh/ has methodology, skills, plus original 4 guides" {
  [ -f "${DOCS}/guide/zh/overview.md" ]
  [ -f "${DOCS}/guide/zh/loop.md" ]
  [ -f "${DOCS}/guide/zh/dream.md" ]
  [ -f "${DOCS}/guide/zh/peer.md" ]
  [ -f "${DOCS}/guide/zh/methodology.md" ]
  [ -f "${DOCS}/guide/zh/skills.md" ]
}

@test "e2e: docs/practices/ has loop-autorun-verification.md" {
  [ -f "${DOCS}/practices/loop-autorun-verification.md" ]
}
