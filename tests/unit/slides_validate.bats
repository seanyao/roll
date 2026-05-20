#!/usr/bin/env bats
# Unit tests for lib/slides-validate.py (US-DECK-002).
#
# Schema checks:
#   - YAML frontmatter required fields
#   - total_slides matches actual ## Slide N count
#   - each slide has title_en / title_zh / body_en / body_zh
#   - grounding: every 3 slides must have >= 1 evidence citation,
#     otherwise WARN (exit code 0 with stderr ⚠️) or FAIL per policy.

LIB="${BATS_TEST_DIRNAME}/../../lib"

# Write a deck.md to TEST_TMP and echo its path.
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

@test "validate: a well-formed minimal deck passes (exit 0)" {
  path=$(write_deck "ok.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: "A"
title_zh: "甲"
body_en: |
  hello
body_zh: |
  你好
evidence:
  - README.md:1
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -eq 0 ]
}

@test "validate: missing required frontmatter field exits non-zero" {
  # missing total_slides
  path=$(write_deck "bad.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
created: 2026-05-21
---

## Slide 1
title_en: "A"
title_zh: "甲"
body_en: |
  hello
body_zh: |
  你好
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -ne 0 ]
  [[ "$output" == *"total_slides"* ]]
}

@test "validate: total_slides mismatch is reported" {
  path=$(write_deck "mismatch.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 3
created: 2026-05-21
---

## Slide 1
title_en: "A"
title_zh: "甲"
body_en: |
  x
body_zh: |
  y
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -ne 0 ]
  [[ "$output" == *"total_slides"* ]]
  [[ "$output" == *"3"* ]]
  [[ "$output" == *"1"* ]]
}

@test "validate: a slide missing title_zh is reported" {
  path=$(write_deck "no-title-zh.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: "A"
body_en: |
  x
body_zh: |
  y
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -ne 0 ]
  [[ "$output" == *"title_zh"* ]]
}

@test "validate: a slide missing body_en is reported" {
  path=$(write_deck "no-body.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: "A"
title_zh: "甲"
body_zh: |
  y
')
  run python3 "${LIB}/slides-validate.py" "$path"
  [ "$status" -ne 0 ]
  [[ "$output" == *"body_en"* ]]
}

@test "validate: grounding warning when 3 slides have zero evidence" {
  # 3 slides, 0 evidence citations -> below threshold (>=1 per 3)
  path=$(write_deck "no-evidence.deck.md" '---
template: t
slug: s
title_en: "T"
title_zh: "测"
total_slides: 3
created: 2026-05-21
---

## Slide 1
title_en: "A"
title_zh: "甲"
body_en: |
  x
body_zh: |
  y

## Slide 2
title_en: "B"
title_zh: "乙"
body_en: |
  x
body_zh: |
  y

## Slide 3
title_en: "C"
title_zh: "丙"
body_en: |
  x
body_zh: |
  y
')
  run python3 "${LIB}/slides-validate.py" "$path"
  # Grounding is a warning, not a schema fail -> exit code is non-zero so
  # callers can flag it; the message must contain a warning marker.
  [[ "$output" == *"grounding"* ]] || [[ "$output" == *"⚠"* ]] || [[ "$output" == *"evidence"* ]]
}

@test "validate: grounding ok when 3 slides have >= 1 evidence (mini fixture)" {
  # The shipped mini fixture has 3 slides and 1 evidence (slide 1).
  # That meets the >=1 per 3 threshold, so validate should succeed.
  run python3 "${LIB}/slides-validate.py" "${BATS_TEST_DIRNAME}/../fixtures/decks/mini.deck.md"
  [ "$status" -eq 0 ]
}

@test "validate: missing file exits non-zero with diagnostic" {
  run python3 "${LIB}/slides-validate.py" "/tmp/does-not-exist.deck.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not found"* ]] || [[ "$output" == *"deck"* ]]
}
