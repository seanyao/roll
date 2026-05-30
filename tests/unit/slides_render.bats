#!/usr/bin/env bats
# Unit tests for lib/slides-render.py (US-DECK-002).
#
# Exercises:
#   - deck.md parser (YAML frontmatter + per-slide sections)
#   - Mustache subset: {{var}}, {{{raw}}}, {{#section}}, {{^inverted}}
#   - HTML escaping for {{var}}, raw for {{{var}}}
#   - markdown body rendering (stdlib fallback or `markdown` lib)
#   - golden-master: fixed deck.md + template -> deterministic HTML

LIB="${BATS_TEST_DIRNAME}/../../lib"
FIX="${BATS_TEST_DIRNAME}/../fixtures/decks"

run_render_module() {
  python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('sr', '${LIB}/slides-render.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
$1
"
}

@test "parse_frontmatter: returns dict with top-level fields" {
  run run_render_module '
src = """---
template: foo
slug: bar
title_en: \"Hello\"
title_zh: \"你好\"
total_slides: 5
created: 2026-05-21
---

## Slide 1
title_en: \"x\"
"""
fm, body = mod.parse_frontmatter(src)
print(fm["template"], fm["slug"], fm["title_en"], fm["title_zh"], fm["total_slides"], fm["created"])
'
  [ "$status" -eq 0 ]
  [[ "$output" == "foo bar Hello 你好 5 2026-05-21" ]]
}

@test "parse_slides: splits ## Slide N sections into a list" {
  run run_render_module '
src = """---
template: t
slug: s
title_en: \"T\"
title_zh: \"T\"
total_slides: 2
created: 2026-05-21
---

## Slide 1
title_en: \"A\"
title_zh: \"甲\"
body_en: |
  hello
body_zh: |
  你好

## Slide 2
title_en: \"B\"
title_zh: \"乙\"
body_en: |
  world
body_zh: |
  世界
"""
fm, body = mod.parse_frontmatter(src)
slides = mod.parse_slides(body)
print(len(slides), slides[0]["title_en"], slides[1]["title_zh"])
print(slides[0]["body_en"].strip(), "|", slides[1]["body_zh"].strip())
'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "2 A 乙" ]]
  [[ "${lines[1]}" == "hello | 世界" ]]
}

@test "parse_slides: extracts evidence list" {
  run run_render_module '
src = """---
template: t
slug: s
title_en: \"T\"
title_zh: \"T\"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: \"A\"
title_zh: \"甲\"
body_en: |
  x
body_zh: |
  y
evidence:
  - README.md:42
  - .roll/x.md:7
"""
_, body = mod.parse_frontmatter(src)
slides = mod.parse_slides(body)
print(len(slides[0]["evidence"]), slides[0]["evidence"][0], slides[0]["evidence"][1])
'
  [ "$status" -eq 0 ]
  [[ "$output" == "2 README.md:42 .roll/x.md:7" ]]
}

@test "parse_slides: parses layout scalar + cards list-of-mappings (US-DECK-017)" {
  run run_render_module '
src = """---
template: t
slug: s
title_en: \"T\"
title_zh: \"T\"
total_slides: 1
created: 2026-05-21
---

## Slide 1
layout: cards-2
title_en: \"A\"
title_zh: \"甲\"
cards:
  - title_en: \"Card A\"
    title_zh: \"卡A\"
    body_en: \"alpha\"
    body_zh: \"甲文\"
  - title_en: \"Card B\"
    title_zh: \"卡B\"
    body_en: \"beta\"
    body_zh: \"乙文\"
evidence:
  - README.md:42
"""
_, body = mod.parse_frontmatter(src)
s = mod.parse_slides(body)[0]
print(s["layout"])
print(len(s["cards"]), s["cards"][0]["title_en"], s["cards"][1]["body_zh"])
print(len(s["evidence"]), s["evidence"][0])
'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "cards-2" ]]
  [[ "${lines[1]}" == "2 Card A 乙文" ]]
  [[ "${lines[2]}" == "1 README.md:42" ]]
}

@test "parse_slides: parses compare nested mappings (US-DECK-017)" {
  run run_render_module '
src = """---
template: t
slug: s
title_en: \"T\"
title_zh: \"T\"
total_slides: 1
created: 2026-05-21
---

## Slide 1
layout: compare
title_en: \"A\"
title_zh: \"甲\"
left_title_en: \"Before\"
left_title_zh: \"之前\"
left_items:
  - text_en: \"manual\"
    text_zh: \"手动\"
  - text_en: \"slow\"
    text_zh: \"慢\"
right_title_en: \"After\"
right_title_zh: \"之后\"
right_items:
  - text_en: \"auto\"
    text_zh: \"自动\"
"""
_, body = mod.parse_frontmatter(src)
s = mod.parse_slides(body)[0]
print(s["left_title_en"], s["right_title_zh"])
print(len(s["left_items"]), s["left_items"][1]["text_en"])
print(len(s["right_items"]), s["right_items"][0]["text_zh"])
'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "Before 之后" ]]
  [[ "${lines[1]}" == "2 slow" ]]
  [[ "${lines[2]}" == "1 自动" ]]
}

@test "parse_slides: block literal inside a list item is dedented (US-DECK-017 peer-fix)" {
  run run_render_module '
src = """## Slide 1
layout: cards-2
cards:
  - title_en: \"A\"
    title_zh: \"甲\"
    body_en: |
      Line one
      Line two
    body_zh: |
      第一行
"""
s = mod.parse_slides(src)[0]
print(repr(s["cards"][0]["body_en"]))
'
  [ "$status" -eq 0 ]
  [[ "$output" == "'Line one"*"Line two"* ]]
}

@test "parse_slides: evidence item containing a colon stays a scalar (US-DECK-017 peer-fix)" {
  run run_render_module '
src = """## Slide 1
title_en: \"A\"
title_zh: \"甲\"
evidence:
  - TODO: see README.md:1
  - README.md:42
"""
s = mod.parse_slides(src)[0]
print(type(s["evidence"][0]).__name__, "|", s["evidence"][0])
print(s["evidence"][1])
'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "str | TODO: see README.md:1" ]]
  [[ "${lines[1]}" == "README.md:42" ]]
}

@test "parse_slides: extra-spaced dash keeps continuation lines (US-DECK-017 peer-fix)" {
  run run_render_module '
src = """## Slide 1
cards:
  -   title_en: \"X\"
      title_zh: \"叉\"
      body_en: \"b\"
      body_zh: \"乙\"
"""
s = mod.parse_slides(src)[0]
c = s["cards"][0]
print(len(c), c.get("title_en"), c.get("body_zh"))
'
  [ "$status" -eq 0 ]
  [[ "$output" == "4 X 乙" ]]
}

@test "parse_slides: slide without layout omits the layout key (backward compat)" {
  run run_render_module '
src = """---
template: t
slug: s
title_en: \"T\"
title_zh: \"T\"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: \"A\"
title_zh: \"甲\"
body_en: |
  hello
body_zh: |
  你好
"""
_, body = mod.parse_frontmatter(src)
s = mod.parse_slides(body)[0]
print("has-layout" if "layout" in s else "no-layout")
'
  [ "$status" -eq 0 ]
  [[ "$output" == "no-layout" ]]
}

@test "mustache: {{var}} substitutes and HTML-escapes" {
  run run_render_module '
print(mod.mustache("hi {{name}}", {"name": "<b>Bob</b>"}))
'
  [ "$status" -eq 0 ]
  [[ "$output" == "hi &lt;b&gt;Bob&lt;/b&gt;" ]]
}

@test "mustache: {{{var}}} substitutes raw without escaping" {
  run run_render_module '
print(mod.mustache("hi {{{name}}}", {"name": "<b>Bob</b>"}))
'
  [ "$status" -eq 0 ]
  [[ "$output" == "hi <b>Bob</b>" ]]
}

@test "mustache: {{#section}}..{{/section}} iterates over list" {
  run run_render_module '
print(mod.mustache("[{{#xs}}<{{v}}>{{/xs}}]", {"xs": [{"v":"a"},{"v":"b"},{"v":"c"}]}))
'
  [ "$status" -eq 0 ]
  [[ "$output" == "[<a><b><c>]" ]]
}

@test "mustache: {{^section}} renders when section is empty list" {
  run run_render_module '
print(mod.mustache("{{^xs}}empty{{/xs}}", {"xs": []}))
print(mod.mustache("{{^xs}}empty{{/xs}}", {"xs": [1]}))
'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "empty" ]]
  [[ "${lines[1]}" == "" ]]
}

@test "mustache: {{^section}} renders when key missing or false" {
  run run_render_module '
print(mod.mustache("{{^x}}fallback{{/x}}", {}))
print(mod.mustache("{{^x}}fallback{{/x}}", {"x": False}))
'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "fallback" ]]
  [[ "${lines[1]}" == "fallback" ]]
}

@test "mustache: missing {{var}} renders as empty string" {
  run run_render_module '
print("[" + mod.mustache("{{missing}}", {}) + "]")
'
  [ "$status" -eq 0 ]
  [[ "$output" == "[]" ]]
}

@test "render_markdown: converts headings, bold, lists" {
  run run_render_module '
html = mod.render_markdown("# Title\n\nA **bold** word.\n\n- one\n- two\n")
print("h1" if "<h1>" in html else "no-h1")
print("strong" if "<strong>" in html or "<b>" in html else "no-strong")
print("li" if "<li>" in html else "no-li")
'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "h1" ]]
  [[ "${lines[1]}" == "strong" ]]
  [[ "${lines[2]}" == "li" ]]
}

@test "render_deck: golden-master mini fixture produces deterministic HTML" {
  run python3 "${LIB}/slides-render.py" "${FIX}/mini.deck.md" "${FIX}/mini.template.html"
  [ "$status" -eq 0 ]
  # Three slides rendered (data-slide=1..3)
  [[ "$output" == *'data-slide="1"'* ]]
  [[ "$output" == *'data-slide="2"'* ]]
  [[ "$output" == *'data-slide="3"'* ]]
  # Top-level title substituted
  [[ "$output" == *'<title>Mini Deck / 迷你 Deck</title>'* ]]
  # Markdown rendered to HTML inside body divs
  [[ "$output" == *'<h1>Heading</h1>'* ]] || [[ "$output" == *'<h1>Heading'* ]]
  # Inverted section (empty=missing) rendered
  [[ "$output" == *'non-empty section renders'* ]]
  # CJK preserved
  [[ "$output" == *'<h2 lang="zh">你好</h2>'* ]]
  # List rendering for Slide 2
  [[ "$output" == *'<li>item one</li>'* ]] || [[ "$output" == *'<li>item one'* ]]
}

@test "render_deck: golden-master mini fixture is deterministic (run twice)" {
  out1=$(python3 "${LIB}/slides-render.py" "${FIX}/mini.deck.md" "${FIX}/mini.template.html")
  out2=$(python3 "${LIB}/slides-render.py" "${FIX}/mini.deck.md" "${FIX}/mini.template.html")
  [ "$out1" = "$out2" ]
}

@test "render_deck: missing deck.md exits non-zero with diagnostic" {
  run python3 "${LIB}/slides-render.py" "/tmp/does-not-exist-deck.md" "${FIX}/mini.template.html"
  [ "$status" -ne 0 ]
  [[ "$output" == *"deck"* ]] || [[ "$output" == *"not found"* ]]
}
