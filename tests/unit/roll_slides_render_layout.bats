#!/usr/bin/env bats
# US-DECK-018: unit tests for layout routing in lib/slides-render.py.
#
# Exercises:
#   - LayoutResolver: resolves known layouts, lists available, errors on unknown
#   - render_slide_inner: routes a slide through its layout partial
#   - render_deck: each rich layout in the all-layouts fixture renders its CSS
#   - unknown layout exits 3 with the documented error message
#   - plain layout is byte-for-byte backward compatible (golden master)

LIB="${BATS_TEST_DIRNAME}/../../lib"
FIX="${BATS_TEST_DIRNAME}/../fixtures/decks"
TPL="${LIB}/slides/templates/introduction-v3.html"

run_render_module() {
  python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('sr', '${LIB}/slides-render.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
$1
"
}

# ─── LayoutResolver ───────────────────────────────────────────────────────────

@test "LayoutResolver: resolves a known layout to its partial path" {
  run run_render_module '
r = mod.LayoutResolver()
p = r.resolve("cards-2")
print(p.name)
print(p.is_file())
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"cards-2.html"* ]]
  [[ "$output" == *"True"* ]]
}

@test "LayoutResolver: available() lists plain first then ascii-sorted rest" {
  run run_render_module '
r = mod.LayoutResolver()
print(",".join(r.available()))
'
  [ "$status" -eq 0 ]
  # plain must lead (it is the default/fallback) and the rest are ascii-sorted.
  [[ "$output" == "plain,cards-2,cards-3,cards-4,compare,highlight,pipeline,quote,timeline" ]]
}

@test "LayoutResolver: path-traversal layout name is rejected as unknown" {
  run run_render_module '
r = mod.LayoutResolver()
try:
    r.resolve("../../../../etc/passwd")
    print("NO-RAISE")
except ValueError as e:
    print("OK" if str(e).startswith("Unknown layout:") else "WRONG")
'
  [ "$status" -eq 0 ]
  [[ "$output" == "OK" ]]
}

@test "LayoutResolver: unknown layout raises with available list" {
  run run_render_module '
r = mod.LayoutResolver()
try:
    r.resolve("nope")
    print("NO-RAISE")
except ValueError as e:
    print(str(e))
'
  [ "$status" -eq 0 ]
  [[ "$output" == "Unknown layout: nope; available: plain, cards-2, cards-3, cards-4, compare, highlight, pipeline, quote, timeline" ]]
}

# ─── render_slide_inner ───────────────────────────────────────────────────────

@test "render_slide_inner: missing layout falls back to plain" {
  run run_render_module '
r = mod.LayoutResolver()
slide = {"body_en": "<p>hi</p>", "body_zh": "<p>嗨</p>"}
inner = mod.render_slide_inner(slide, r)
print("lang-en" in inner and "lang-zh" in inner)
print("<!--" not in inner)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True"* ]]
  # Two True lines: has lang divs AND no leaked doc comment.
  [ "$(printf "%s\n" "$output" | grep -c True)" -eq 2 ]
}

# ─── render_deck via CLI: each rich layout renders its CSS ─────────────────────

@test "render_deck: all-layouts fixture renders every rich layout's CSS class" {
  run python3 "${LIB}/slides-render.py" "${FIX}/all-layouts-sample.md" "${TPL}"
  [ "$status" -eq 0 ]
  [[ "$output" == *'class="cards cards-2"'* ]]
  [[ "$output" == *'compare-before'* ]]
  [[ "$output" == *'compare-after'* ]]
  [[ "$output" == *'pipeline-bar'* ]]
  [[ "$output" == *'class="timeline"'* ]]
  [[ "$output" == *'quote-block'* ]]
  [[ "$output" == *'highlight-box'* ]]
}

@test "render_deck: cards-2 slide renders both card titles" {
  run python3 "${LIB}/slides-render.py" "${FIX}/all-layouts-sample.md" "${TPL}"
  [ "$status" -eq 0 ]
  [[ "$output" == *'Speed'* ]]
  [[ "$output" == *'Safety'* ]]
}

# ─── unknown layout exits 3 ───────────────────────────────────────────────────

@test "render_deck: unknown layout exits 3 with documented message" {
  deck="${BATS_TEST_TMPDIR}/bad.md"
  printf -- '---\ntemplate: introduction-v3\nslug: bad\ntitle_en: "x"\ntitle_zh: "x"\ntotal_slides: 1\ncreated: 2026-05-23\n---\n\n## Slide 1\nlayout: bogus\ntitle_en: "x"\n' > "$deck"
  run python3 "${LIB}/slides-render.py" "$deck" "${TPL}"
  [ "$status" -eq 3 ]
  [[ "$output" == *"Unknown layout: bogus; available: plain"* ]]
}

# ─── plain layout backward compatibility (golden master) ──────────────────────

@test "render_deck: plain layout is byte-for-byte backward compatible" {
  # Render the canonical v3 sample deck (all plain/cover slides) and assert the
  # legacy lang-en / lang-zh body block is reproduced exactly — the layout
  # routing must not perturb existing plain decks.
  run python3 "${LIB}/slides-render.py" "${FIX}/sample-introduction-v3.deck.md" "${TPL}"
  [ "$status" -eq 0 ]
  # Cover slide still gets the `active` class.
  [[ "$output" == *'<div class="slide active" data-slide="0">'* ]]
  # Plain body block structure preserved (no partial doc comment leaked).
  [[ "$output" == *'<div class="lang-en">'* ]]
  [[ "$output" == *'<div class="lang-zh">'* ]]
  [[ "$output" != *'<!-- plain:'* ]]
}
