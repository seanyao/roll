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

# ─── US-DECK-021: Layouts reference (Phase 2 doc refresh) ────────────────────

# The canonical layout whitelist, kept in sync across guide / skill / components.
LAYOUTS="plain cards-2 cards-3 cards-4 compare pipeline timeline quote highlight"

@test "slides.md (en) has a Layouts section" {
  grep -qF "## Layouts" "${EN}"
}

@test "slides.md (zh) has a Layouts section" {
  grep -qF "## Layouts（布局）" "${ZH}"
}

@test "slides.md (en) documents every whitelisted layout name" {
  for l in ${LAYOUTS}; do
    grep -qF "\`${l}\`" "${EN}" || { echo "missing layout in en: ${l}"; return 1; }
  done
}

@test "slides.md (zh) documents every whitelisted layout name" {
  for l in ${LAYOUTS}; do
    grep -qF "\`${l}\`" "${ZH}" || { echo "missing layout in zh: ${l}"; return 1; }
  done
}

@test "slides.md (en) documents the rich-layout structured fields" {
  grep -qF "left_items" "${EN}"
  grep -qF "right_items" "${EN}"
  grep -qF "stages" "${EN}"
  grep -qF "css_class" "${EN}"
  grep -qF "cards" "${EN}"
  grep -qF "text_en" "${EN}"
}

@test "slides.md (zh) documents the rich-layout structured fields" {
  grep -qF "left_items" "${ZH}"
  grep -qF "right_items" "${ZH}"
  grep -qF "stages" "${ZH}"
  grep -qF "css_class" "${ZH}"
  grep -qF "cards" "${ZH}"
  grep -qF "text_en" "${ZH}"
}

@test "slides.md (en) explains how \$roll-deck picks a layout" {
  grep -qF "How \`\$roll-deck\` picks a layout" "${EN}"
  grep -qF "Layout Selection Playbook" "${EN}"
}

@test "slides.md (zh) explains how \$roll-deck picks a layout" {
  grep -qF "\`\$roll-deck\` 怎么挑 layout" "${ZH}"
  grep -qF "Layout 选择手册" "${ZH}"
}

@test "every layout has a screenshot PNG under guide/assets/layouts" {
  for l in ${LAYOUTS}; do
    f="${ROOT}/guide/assets/layouts/${l}.png"
    [ -s "$f" ] || { echo "missing or empty screenshot: ${f}"; return 1; }
  done
}

@test "slides.md (en) embeds every layout screenshot" {
  for l in ${LAYOUTS}; do
    grep -qF "assets/layouts/${l}.png" "${EN}" || { echo "en missing img: ${l}"; return 1; }
  done
}

@test "slides.md (zh) embeds every layout screenshot" {
  for l in ${LAYOUTS}; do
    grep -qF "assets/layouts/${l}.png" "${ZH}" || { echo "zh missing img: ${l}"; return 1; }
  done
}

@test "README index adds a Layouts reference sub-link" {
  grep -qF "guide/en/slides.md#layouts" "${ROOT}/README.md"
  grep -qF "guide/en/slides.md#layouts" "${ROOT}/README_CN.md"
}

@test "components README cross-links the guide Layouts section" {
  README="${ROOT}/lib/slides/components/README.md"
  grep -qF "guide/en/slides.md#layouts" "${README}"
}

# ─── No drift: skill playbook ⇄ guide ⇄ components README ────────────────────

@test "roll-deck SKILL whitelists exactly the documented layouts" {
  SKILL="${ROOT}/skills/roll-deck/SKILL.md"
  for l in ${LAYOUTS}; do
    grep -qF "\`${l}\`" "${SKILL}" || { echo "SKILL.md missing layout: ${l}"; return 1; }
  done
}

@test "components README whitelists exactly the documented layouts" {
  README="${ROOT}/lib/slides/components/README.md"
  for l in ${LAYOUTS}; do
    grep -qF "\`${l}\`" "${README}" || { echo "components README missing layout: ${l}"; return 1; }
  done
}

@test "no doc still describes the Phase 1 two-field-only schema" {
  # Phase 1 docs said slides have exactly "four required keys"
  # (title_en/title_zh/body_en/body_zh) with no layout. That phrasing must be gone.
  ! grep -qF "four required keys" "${EN}"
  ! grep -qF "四个必需键" "${ZH}"
}
