#!/usr/bin/env bats
# US-DECK-011: slides list 4-state status + .last-build.err + slides logs

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

_make_deck() {
  local slug="$1" template="${2:-introduction-v3}" slides="${3:-1}" created="${4:-2026-05-22}"
  mkdir -p ".roll/slides/${slug}"
  cat > ".roll/slides/${slug}/deck.md" <<EOF
---
template: ${template}
slug: ${slug}
title_en: Test Deck
title_zh: 测试
total_slides: ${slides}
created: ${created}
---

## Slide 1
title_en: Title
title_zh: 标题
body_en: Content
body_zh: 内容
evidence:
  - README.md:1
EOF
}

_make_html() {
  local slug="$1" size="${2:-1024}"
  dd if=/dev/zero of=".roll/slides/${slug}.html" bs=1 count="$size" 2>/dev/null
}

_make_err() {
  local slug="$1" msg="${2:-render failed}"
  mkdir -p ".roll/slides/${slug}"
  echo "$msg" > ".roll/slides/${slug}/.last-build.err"
}

# Extract the built column value for a given slug from the list output.
# The built column is 2nd-to-last in the table.
_list_built_for() {
  local slug="$1"
  run bash "$ROLL_BIN" slides list 2>/dev/null
  # Find the row starting with slug, print the 2nd-to-last field
  echo "$output" | grep "^${slug} " | awk '{print $(NF-1)}'
}

# ─── 4-state built column ────────────────────────────────────────────────────

@test "list: html exists + no err → built" {
  _make_deck "mydeck"
  _make_html "mydeck"
  run _list_built_for "mydeck"
  [[ "$output" == *"built"* ]]
}

@test "list: html exists + deck.md newer → stale" {
  _make_deck "mydeck"
  _make_html "mydeck"
  sleep 1
  echo "# updated" >> ".roll/slides/mydeck/deck.md"
  run _list_built_for "mydeck"
  [[ "$output" == *"stale"* ]]
}

@test "list: .last-build.err exists → failed" {
  _make_deck "mydeck"
  _make_err "mydeck" "validator failed: missing title_zh"
  run _list_built_for "mydeck"
  [[ "$output" == *"failed"* ]]
}

@test "list: .last-build.err wins over stale (failed takes priority)" {
  _make_deck "mydeck"
  _make_html "mydeck"
  sleep 1
  echo "# updated" >> ".roll/slides/mydeck/deck.md"
  _make_err "mydeck" "render crashed"
  run _list_built_for "mydeck"
  [[ "$output" == *"failed"* ]]
}

@test "list: no html + no err → unbuilt" {
  _make_deck "mydeck"
  run _list_built_for "mydeck"
  [[ "$output" == *"unbuilt"* ]]
}

# ─── .last-build.err lifecycle ───────────────────────────────────────────────

@test "build failure writes .last-build.err with stage + reason" {
  _make_deck "mydeck"
  # Create invalid deck.md that validator rejects
  echo "garbage" > ".roll/slides/mydeck/deck.md"
  run bash "$ROLL_BIN" slides build mydeck --no-open 2>/dev/null
  [ "$status" -ne 0 ]
  [ -f ".roll/slides/mydeck/.last-build.err" ]
  run cat ".roll/slides/mydeck/.last-build.err"
  [[ "$output" == *"validate"* ]] || [[ "$output" == *"validator"* ]] || [[ "$output" == *"YAML"* ]]
}

@test "build success removes stale .last-build.err" {
  _make_deck "mydeck"
  _make_err "mydeck" "previous failure"
  run bash "$ROLL_BIN" slides build mydeck --no-open 2>/dev/null
  [ "$status" -eq 0 ]
  [ ! -f ".roll/slides/mydeck/.last-build.err" ]
}

# ─── slides logs command ─────────────────────────────────────────────────────

@test "slides logs shows error content" {
  _make_deck "mydeck"
  _make_err "mydeck" "validate failed: slide 7 missing title_en"
  run bash "$ROLL_BIN" slides logs mydeck 2>/dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"validate failed"* ]]
  [[ "$output" == *"slide 7"* ]]
}

@test "slides logs on clean deck shows friendly message" {
  _make_deck "mydeck"
  run bash "$ROLL_BIN" slides logs mydeck 2>/dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"没有失败记录"* ]] || [[ "$output" == *"no failure"* ]]
}

@test "slides logs on missing deck shows error" {
  run bash "$ROLL_BIN" slides logs nosuchdeck 2>/dev/null
  [ "$status" -ne 0 ]
}

@test "slides logs: slug with no dot dir returns error" {
  # Deck dir exists but no .last-build.err
  _make_deck "mydeck"
  run bash "$ROLL_BIN" slides logs mydeck 2>/dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"没有失败记录"* ]] || [[ "$output" == *"no failure"* ]]
}

# ─── list empty dir ──────────────────────────────────────────────────────────

@test "list: no decks shows friendly message" {
  run bash "$ROLL_BIN" slides list 2>/dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"No decks"* ]] || [[ "$output" == *"无幻灯片"* ]]
}
