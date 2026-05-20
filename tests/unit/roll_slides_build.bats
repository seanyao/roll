#!/usr/bin/env bats
# Unit tests for `roll slides build` (US-DECK-003).
#
# Exercises cmd_slides() in bin/roll:
#   - Happy path: fixture deck.md → renders to .roll/slides/<slug>.html
#   - Missing deck.md → friendly bilingual error + non-zero exit
#   - Schema validation failure → exit non-zero + diagnostics printed
#   - --no-open suppresses browser launch
#   - --help is bilingual (EN + ZH)
#   - Unimplemented subcommands (new / list / preview) report a clear stub error
#   - Default .roll/.gitignore appends `slides/*.html`

load helpers

setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

REPO="${BATS_TEST_DIRNAME}/../.."
FIX="${REPO}/tests/fixtures/decks"

# ─── Stub the browser-open command so tests never spawn a UI process ─────────
# `open` (macOS) / `xdg-open` (Linux) are stubbed via a tmp PATH directory.
_stub_open_cmd() {
  mkdir -p "${TEST_TMP}/stubbin"
  cat >"${TEST_TMP}/stubbin/open" <<'EOF'
#!/usr/bin/env bash
printf 'STUB_OPEN_CALLED:%s\n' "$*" >>"${TEST_TMP}/open.log"
EOF
  cat >"${TEST_TMP}/stubbin/xdg-open" <<'EOF'
#!/usr/bin/env bash
printf 'STUB_OPEN_CALLED:%s\n' "$*" >>"${TEST_TMP}/open.log"
EOF
  chmod +x "${TEST_TMP}/stubbin/open" "${TEST_TMP}/stubbin/xdg-open"
  export PATH="${TEST_TMP}/stubbin:${PATH}"
  : >"${TEST_TMP}/open.log"
}

# Lay down a `.roll/` skeleton + a minimal known-good deck.md for the slug.
# Schema-valid (matches total_slides), grounding-valid (>=1 evidence per 3 slides),
# and references the `introduction-v3` template that ships with the package.
_seed_deck() {
  local slug="${1:-roll-intro}"
  mkdir -p ".roll/slides/${slug}"
  cat >".roll/slides/${slug}/deck.md" <<'EOF'
---
template: introduction-v3
slug: roll-intro
title_en: "ROLL — Test Deck"
title_zh: "ROLL — 测试幻灯片"
total_slides: 3
created: 2026-05-21
---

## Slide 1
title_en: "Intro"
title_zh: "引言"
body_en: |
  Hello, ROLL.
body_zh: |
  你好，ROLL。
evidence:
  - README.md:1

## Slide 2
title_en: "Body"
title_zh: "正文"
body_en: |
  Some body text.
body_zh: |
  一些正文。

## Slide 3
title_en: "Closing"
title_zh: "结语"
body_en: |
  Thanks.
body_zh: |
  谢谢。
EOF
  echo "$slug"
}

# ─── Subcommand dispatch ─────────────────────────────────────────────────────

@test "cmd_slides: no subcommand prints usage and exits non-zero" {
  run cmd_slides
  [ "$status" -ne 0 ]
  [[ "$output" == *"roll slides"* ]]
}

@test "cmd_slides: unknown subcommand prints error" {
  run cmd_slides bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"bogus"* || "$output" == *"Unknown"* || "$output" == *"未知"* ]]
}

@test "cmd_slides: --help shows bilingual help (EN + ZH)" {
  run cmd_slides --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"build"* ]]
  # Bilingual: English keyword + a specific Chinese substring from _slides_help.
  # (CJK Unicode ranges in bash regex are unreliable under the CI runner locale.)
  [[ "$output" == *"幻灯片"* ]]
}

@test "cmd_slides: 'new' subcommand dispatches to cmd_slides_new (US-DECK-004)" {
  # `new` with no topic must surface the new command's usage error, not a
  # not-implemented stub. (Full wiring is exercised in roll_slides_new.bats.)
  run cmd_slides new
  [ "$status" -ne 0 ]
  [[ "$output" == *"topic"* || "$output" == *"Usage"* || "$output" == *"用法"* ]]
}

# 'list' and 'preview' subcommands are implemented in US-DECK-005 — see
# tests/unit/roll_slides_list_preview.bats.

# ─── build: error paths ──────────────────────────────────────────────────────

@test "cmd_slides build: no slug arg → usage error" {
  run cmd_slides build
  [ "$status" -ne 0 ]
  [[ "$output" == *"slug"* || "$output" == *"Usage"* ]]
}

@test "cmd_slides build: missing deck.md → friendly bilingual error + hint to roll slides new" {
  run cmd_slides build does-not-exist
  [ "$status" -ne 0 ]
  [[ "$output" == *"does-not-exist"* ]]
  [[ "$output" == *"roll slides new"* ]]
  # Bilingual hint — match the exact ZH prefix the cmd emits.
  # (CJK Unicode ranges in bash regex are unreliable under the CI runner locale.)
  [[ "$output" == *"未找到"* ]]
}

@test "cmd_slides build: schema-invalid deck.md → non-zero exit + diagnostics" {
  local slug="bad-deck"
  mkdir -p ".roll/slides/${slug}"
  # Missing required frontmatter fields → validator returns 1.
  cat >".roll/slides/${slug}/deck.md" <<'EOF'
---
template: introduction-v3
slug: bad-deck
---

## Slide 1
title_en: "x"
EOF
  _stub_open_cmd
  run cmd_slides build "$slug" --no-open
  [ "$status" -ne 0 ]
  # Validator diagnostic prefix should be visible
  [[ "$output" == *"slides-validate"* || "$output" == *"missing required"* || "$output" == *"validation"* ]]
}

# ─── build: happy path ───────────────────────────────────────────────────────

@test "cmd_slides build: happy path renders HTML to .roll/slides/<slug>.html" {
  local slug; slug=$(_seed_deck roll-intro)
  _stub_open_cmd
  run cmd_slides build "$slug" --no-open
  [ "$status" -eq 0 ]
  [ -f ".roll/slides/${slug}.html" ]
  # Output mentions where the HTML went so users can find it.
  [[ "$output" == *".roll/slides/${slug}.html"* ]]
  # HTML is non-trivial and includes the title from frontmatter.
  grep -q "ROLL" ".roll/slides/${slug}.html"
}

@test "cmd_slides build: --no-open prevents calling the browser-open command" {
  local slug; slug=$(_seed_deck roll-intro)
  _stub_open_cmd
  run cmd_slides build "$slug" --no-open
  [ "$status" -eq 0 ]
  [ ! -s "${TEST_TMP}/open.log" ]
}

@test "cmd_slides build: appends slides/*.html to .roll/.gitignore (creates file if absent)" {
  local slug; slug=$(_seed_deck roll-intro)
  _stub_open_cmd
  run cmd_slides build "$slug" --no-open
  [ "$status" -eq 0 ]
  [ -f ".roll/.gitignore" ]
  grep -qE '^slides/\*\.html$' ".roll/.gitignore"
}

@test "cmd_slides build: idempotent on .roll/.gitignore (no duplicate slides/*.html)" {
  local slug; slug=$(_seed_deck roll-intro)
  _stub_open_cmd
  # First build
  run cmd_slides build "$slug" --no-open
  [ "$status" -eq 0 ]
  # Second build
  run cmd_slides build "$slug" --no-open
  [ "$status" -eq 0 ]
  local count
  count=$(grep -cE '^slides/\*\.html$' ".roll/.gitignore")
  [ "$count" -eq 1 ]
}
