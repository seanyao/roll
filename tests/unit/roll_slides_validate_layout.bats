#!/usr/bin/env bats
# Unit tests for the layout schema rules in lib/slides-validate.py (US-DECK-017).
#
# Covers the three error classes from the AC:
#   - whitelist     : an unknown layout name is rejected
#   - required field: a layout's required field missing is reported with a
#                     deck.md:<line> location + a field example
#   - type error    : a list item missing a required sub-field is reported
# Plus backward compat (no `layout:` -> plain, no error) and the non-fatal
# redundant-body warning.

LIB="${BATS_TEST_DIRNAME}/../../lib"
FIX="${BATS_TEST_DIRNAME}/../fixtures/decks"

write_deck() {
  local name="$1"; shift
  local content="$1"; shift
  local path="${TEST_TMP}/${name}"
  printf '%s' "$content" > "$path"
  echo "$path"
}

setup() {
  TEST_TMP="$(mktemp -d)"
}

teardown() {
  rm -rf "${TEST_TMP:-}"
}

# ── happy paths: every shipped layout fixture validates ──────────────────────

@test "validate-layout: every layout fixture passes (exit 0)" {
  for name in cards-2 compare pipeline timeline quote highlight; do
    run python3 "${LIB}/slides-validate.py" "${FIX}/layout-${name}.md"
    [ "$status" -eq 0 ] || {
      echo "layout-${name} failed: $output"
      return 1
    }
  done
}

# ── whitelist ────────────────────────────────────────────────────────────────

@test "validate-layout: unknown layout name is rejected against whitelist" {
  path=$(write_deck "unknown.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-23
---

## Slide 1
layout: fancy-grid
title_en: "A"
title_zh: "甲"
body_en: |
  x
body_zh: |
  y
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown layout"* ]]
  [[ "$output" == *"fancy-grid"* ]]
  # whitelist is listed so the author knows the valid set
  [[ "$output" == *"cards-2"* ]]
}

# ── required field missing (with line + example) ─────────────────────────────

@test "validate-layout: cards-2 without cards reports line + example" {
  path=$(write_deck "missing.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-23
---

## Slide 1
layout: cards-2
title_en: "A"
title_zh: "甲"
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"requires field"* ]]
  [[ "$output" == *"cards"* ]]
  # concrete location: the slide header is on line 10
  [[ "$output" == *"deck.md:10"* ]]
  # field example for the layout
  [[ "$output" == *"title_en:"* ]]
}

@test "validate-layout: compare without right_items is reported" {
  path=$(write_deck "compare-bad.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-23
---

## Slide 1
layout: compare
title_en: "A"
title_zh: "甲"
left_title_en: "Before"
left_title_zh: "之前"
right_title_en: "After"
right_title_zh: "之后"
left_items:
  - text_en: "x"
    text_zh: "甲"
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"right_items"* ]]
}

# ── type error: list item missing a sub-field ────────────────────────────────

@test "validate-layout: cards item missing title_zh is reported per-item" {
  path=$(write_deck "item-bad.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-23
---

## Slide 1
layout: cards-2
title_en: "A"
title_zh: "甲"
cards:
  - title_en: "Only EN"
    body_en: "x"
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"cards[1]"* ]]
  [[ "$output" == *"title_zh"* ]]
}

# ── backward compat: no layout == plain, no error ────────────────────────────

@test "validate-layout: a slide with no layout validates as plain" {
  # mini fixture has 3 plain slides, none declares `layout:`.
  run python3 "${LIB}/slides-validate.py" "${FIX}/mini.deck.md"
  [ "$status" -eq 0 ]
}

# ── non-fatal warning: rich layout carrying a stray body ─────────────────────

@test "validate-layout: rich layout + stray body warns but does not fail" {
  path=$(write_deck "redundant.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-23
---

## Slide 1
layout: quote
title_en: "A"
title_zh: "甲"
text_en: "hi"
text_zh: "你好"
body_en: |
  stray
body_zh: |
  多余
evidence:
  - README.md:1
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -eq 0 ]
  [[ "$output" == *"does not use"* ]]
  [[ "$output" == *"body_en"* ]]
}
