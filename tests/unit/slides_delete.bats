#!/usr/bin/env bats
# US-DECK-014: roll slides delete command

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

_make_deck() {
  local slug="$1"
  mkdir -p ".roll/slides/${slug}"
  cat > ".roll/slides/${slug}/deck.md" <<EOF
---
template: introduction-v3
slug: ${slug}
title_en: Test Deck
title_zh: 测试
total_slides: 1
created: 2026-05-22
---

## Slide 1
title_en: Title
title_zh: 标题
body_en: Content
body_zh: 内容
evidence:
  - README.md:1
EOF
  touch ".roll/slides/${slug}.html"
}

@test "delete: removes deck dir and HTML with --force" {
  _make_deck "mydeck"
  run bash "$ROLL_BIN" slides delete mydeck --force
  [[ "$status" -eq 0 ]]
  [[ ! -d ".roll/slides/mydeck" ]]
  [[ ! -f ".roll/slides/mydeck.html" ]]
}

@test "delete: non-existent slug returns error" {
  run bash "$ROLL_BIN" slides delete nosuchdeck --force
  [[ "$status" -ne 0 ]]
}

@test "delete: missing slug argument shows usage" {
  run bash "$ROLL_BIN" slides delete
  [[ "$status" -ne 0 ]]
}

@test "delete: --force is required when not in TTY" {
  _make_deck "mydeck"
  # Simulate non-TTY by piping and NOT passing --force
  run bash "$ROLL_BIN" slides delete mydeck < /dev/null
  [[ "$status" -ne 0 ]]
  # Deck should still exist
  [[ -d ".roll/slides/mydeck" ]]
}

@test "delete: unknown flag returns error" {
  run bash "$ROLL_BIN" slides delete --unknown foo
  [[ "$status" -ne 0 ]]
}

@test "delete: help flag shows help" {
  run bash "$ROLL_BIN" slides delete --help
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"delete"* ]]
}
