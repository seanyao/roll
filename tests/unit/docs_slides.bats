#!/usr/bin/env bats
# US-DECK-006: verify the slides user guide exists in both languages and the
# READMEs reference it. Uses literal substring checks only (no Unicode regex,
# which is unreliable across CI runners).

ROOT="${BATS_TEST_DIRNAME}/../.."
EN="${ROOT}/guide/en/slides.md"
ZH="${ROOT}/guide/zh/slides.md"

# ─── Files exist ─────────────────────────────────────────────────────────────

@test "guide en: slides.md exists" {
  [ -f "${EN}" ]
}

@test "guide zh: slides.md exists" {
  [ -f "${ZH}" ]
}

# ─── English doc structure ───────────────────────────────────────────────────

@test "slides.md (en) has top-level heading" {
  grep -qF "# Roll — Slides" "${EN}"
}

@test "slides.md (en) covers What & Why" {
  grep -qF "## What & Why" "${EN}"
}

@test "slides.md (en) covers Quick Start" {
  grep -qF "## Quick Start" "${EN}"
}

@test "slides.md (en) documents the four quick-start steps" {
  grep -qF "roll slides new" "${EN}"
  grep -qF "roll slides build" "${EN}"
  grep -qF "roll slides list" "${EN}"
  grep -qF "roll slides preview" "${EN}"
}

@test "slides.md (en) has deck.md format reference" {
  grep -qF "deck.md\` Format Reference" "${EN}"
  grep -qF "Frontmatter" "${EN}"
  grep -qF "Slide section" "${EN}"
}

@test "slides.md (en) documents Mustache placeholder subset" {
  grep -qF "Supported Mustache placeholders" "${EN}"
  grep -qF "{{var}}" "${EN}"
  grep -qF "{{{var}}}" "${EN}"
  grep -qF "{{#section}}" "${EN}"
  grep -qF "{{^section}}" "${EN}"
}

@test "slides.md (en) covers grounding & evidence convention" {
  grep -qF "Grounding & Evidence Convention" "${EN}"
  grep -qF "evidence" "${EN}"
}

@test "slides.md (en) documents output location and promotion" {
  grep -qF "Output Location" "${EN}"
  grep -qF ".roll/slides/" "${EN}"
  grep -qF "gitignored" "${EN}"
  grep -qF "site/slides" "${EN}"
}

@test "slides.md (en) covers common pitfalls" {
  grep -qF "Common Pitfalls" "${EN}"
  grep -qF "unverified" "${EN}"
}

# ─── Chinese doc structure (literal substrings only) ────────────────────────

@test "slides.md (zh) has top-level heading" {
  grep -qF "# Roll" "${ZH}"
}

@test "slides.md (zh) references the deck.md format" {
  grep -qF "deck.md" "${ZH}"
  grep -qF "Frontmatter" "${ZH}"
}

@test "slides.md (zh) documents the four quick-start commands" {
  grep -qF "roll slides new" "${ZH}"
  grep -qF "roll slides build" "${ZH}"
  grep -qF "roll slides list" "${ZH}"
  grep -qF "roll slides preview" "${ZH}"
}

@test "slides.md (zh) documents Mustache placeholder subset" {
  grep -qF "Mustache" "${ZH}"
  grep -qF "{{var}}" "${ZH}"
  grep -qF "{{{var}}}" "${ZH}"
  grep -qF "{{#section}}" "${ZH}"
  grep -qF "{{^section}}" "${ZH}"
}

@test "slides.md (zh) covers grounding rule and threshold" {
  grep -qF "Grounding" "${ZH}"
  grep -qF "evidence" "${ZH}"
}

@test "slides.md (zh) covers output location and promotion" {
  grep -qF ".roll/slides/" "${ZH}"
  grep -qF "gitignored" "${ZH}"
  grep -qF "site/slides" "${ZH}"
}

@test "slides.md (zh) covers the unverified pitfall" {
  grep -qF "unverified" "${ZH}"
}

# ─── READMEs reference the new docs ─────────────────────────────────────────

@test "README.md Documentation Index links to guide/en/slides.md" {
  grep -qF "guide/en/slides.md" "${ROOT}/README.md"
}

@test "README.md Documentation Index links to guide/zh/slides.md" {
  grep -qF "guide/zh/slides.md" "${ROOT}/README.md"
}

@test "README_CN.md Documentation Index links to guide/en/slides.md" {
  grep -qF "guide/en/slides.md" "${ROOT}/README_CN.md"
}

@test "README_CN.md Documentation Index links to guide/zh/slides.md" {
  grep -qF "guide/zh/slides.md" "${ROOT}/README_CN.md"
}
