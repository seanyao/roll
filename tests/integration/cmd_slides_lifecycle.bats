#!/usr/bin/env bats
# US-DECK-014: E2E tests for slides templates + delete

load helpers
setup()    { integration_setup; cd "$TEST_TMP"; }
teardown() { rm -rf "${TEST_TMP:-}"; }

_make_minimal_deck() {
  local slug="$1"
  mkdir -p ".roll/slides/${slug}"
  cat > ".roll/slides/${slug}/deck.md" <<EOF
---
template: introduction-v3
slug: ${slug}
title_en: Test
title_zh: 测试
total_slides: 1
created: 2026-05-24
---

## Slide 1
title_en: Hello
title_zh: 你好
body_en: World
body_zh: 世界
EOF
  touch ".roll/slides/${slug}.html"
}

@test "e2e: templates lists built-in templates" {
  run "$ROLL_BIN" slides templates
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"name"* ]]
  [[ "$output" == *"source"* ]]
  [[ "$output" == *"path"* ]]
}

@test "e2e: templates with project override shows override" {
  mkdir -p ".roll/slides/templates"
  touch ".roll/slides/templates/introduction-v3.html"
  run "$ROLL_BIN" slides templates
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"project (override)"* ]]
}

@test "e2e: delete deck with --force" {
  _make_minimal_deck "testdeck"
  run "$ROLL_BIN" slides delete testdeck --force
  [[ "$status" -eq 0 ]]
  [[ ! -d ".roll/slides/testdeck" ]]
  [[ ! -f ".roll/slides/testdeck.html" ]]
}

@test "e2e: delete non-existent deck fails" {
  run "$ROLL_BIN" slides delete bogus --force
  [[ "$status" -ne 0 ]]
}
