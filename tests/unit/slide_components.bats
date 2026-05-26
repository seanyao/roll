#!/usr/bin/env bats
# US-DECK-016: unit tests for lib/slides/components/ Mustache partial library.
#
# Exercises:
#   - Every partial file exists
#   - Every partial renders with sample data without error
#   - Every partial output contains expected CSS classes (grep assertions)

LIB="${BATS_TEST_DIRNAME}/../../lib"
COMP="${LIB}/slides/components"

run_partial() {
  local partial="$1"
  local context="$2"
  python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('sr', '${LIB}/slides-render.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
with open('${COMP}/${partial}') as f:
    tpl = f.read()
ctx = ${context}
print(mod.mustache(tpl, ctx))
"
}

# ─── File existence ──────────────────────────────────────────────────────────

@test "partial: plain.html exists" {
  [ -f "${COMP}/plain.html" ]
}

@test "partial: cards-2.html exists" {
  [ -f "${COMP}/cards-2.html" ]
}

@test "partial: cards-3.html exists" {
  [ -f "${COMP}/cards-3.html" ]
}

@test "partial: cards-4.html exists" {
  [ -f "${COMP}/cards-4.html" ]
}

@test "partial: compare.html exists" {
  [ -f "${COMP}/compare.html" ]
}

@test "partial: pipeline.html exists" {
  [ -f "${COMP}/pipeline.html" ]
}

@test "partial: timeline.html exists" {
  [ -f "${COMP}/timeline.html" ]
}

@test "partial: quote.html exists" {
  [ -f "${COMP}/quote.html" ]
}

@test "partial: highlight.html exists" {
  [ -f "${COMP}/highlight.html" ]
}

@test "README.md exists in components dir" {
  [ -f "${COMP}/README.md" ]
}

# ─── Renders without error ────────────────────────────────────────────────────

@test "plain.html renders without error" {
  run run_partial "plain.html" '{"body_en": "<p>Hello</p>", "body_zh": "<p>你好</p>"}'
  [ "$status" -eq 0 ]
}

@test "cards-2.html renders without error" {
  run run_partial "cards-2.html" '{"cards": [{"title_en": "A", "title_zh": "甲", "body_en": "x", "body_zh": "y"}, {"title_en": "B", "title_zh": "乙", "body_en": "z", "body_zh": "w"}]}'
  [ "$status" -eq 0 ]
}

@test "cards-3.html renders without error" {
  run run_partial "cards-3.html" '{"cards": [{"title_en": "A", "title_zh": "甲", "body_en": "x", "body_zh": "y"}, {"title_en": "B", "title_zh": "乙", "body_en": "z", "body_zh": "w"}, {"title_en": "C", "title_zh": "丙", "body_en": "q", "body_zh": "r"}]}'
  [ "$status" -eq 0 ]
}

@test "cards-4.html renders without error" {
  run run_partial "cards-4.html" '{"cards": [{"title_en": "A", "title_zh": "甲", "body_en": "x", "body_zh": "y"}, {"title_en": "B", "title_zh": "乙", "body_en": "z", "body_zh": "w"}, {"title_en": "C", "title_zh": "丙", "body_en": "q", "body_zh": "r"}, {"title_en": "D", "title_zh": "丁", "body_en": "s", "body_zh": "t"}]}'
  [ "$status" -eq 0 ]
}

@test "compare.html renders without error" {
  run run_partial "compare.html" '{"left_title_en": "Before", "left_title_zh": "之前", "right_title_en": "After", "right_title_zh": "之后", "left_items": [{"text_en": "bad", "text_zh": "坏"}, {"text_en": "slow", "text_zh": "慢"}], "right_items": [{"text_en": "good", "text_zh": "好"}, {"text_en": "fast", "text_zh": "快"}]}'
  [ "$status" -eq 0 ]
}

@test "pipeline.html renders without error" {
  run run_partial "pipeline.html" '{"stages": [{"title_en": "Idea", "title_zh": "想法", "desc_en": "capture", "desc_zh": "捕捉", "css_class": "pipe-idea"}, {"title_en": "Build", "title_zh": "构建", "desc_en": "ship", "desc_zh": "交付", "css_class": "pipe-build"}, {"title_en": "Release", "title_zh": "发布", "desc_en": "publish", "desc_zh": "发布", "css_class": "pipe-release"}]}'
  [ "$status" -eq 0 ]
}

@test "timeline.html renders without error" {
  run run_partial "timeline.html" '{"items": [{"title_en": "Step 1", "title_zh": "第一步", "body_en": "first", "body_zh": "一"}, {"title_en": "Step 2", "title_zh": "第二步", "body_en": "second", "body_zh": "二"}]}'
  [ "$status" -eq 0 ]
}

@test "quote.html renders without error" {
  run run_partial "quote.html" '{"text_en": "Keep it simple.", "text_zh": "保持简单。"}'
  [ "$status" -eq 0 ]
}

@test "highlight.html renders without error" {
  run run_partial "highlight.html" '{"body_en": "<p>Important note</p>", "body_zh": "<p>重要提示</p>"}'
  [ "$status" -eq 0 ]
}

# ─── CSS class assertions ─────────────────────────────────────────────────────

@test "plain.html output contains lang-en and lang-zh wrappers" {
  run run_partial "plain.html" '{"body_en": "<p>Hello</p>", "body_zh": "<p>你好</p>"}'
  grep -qF 'lang-en' <<< "$output"
  grep -qF 'lang-zh' <<< "$output"
}

@test "cards-2.html output contains cards-2 and card classes" {
  run run_partial "cards-2.html" '{"cards": [{"title_en": "A", "title_zh": "甲", "body_en": "x", "body_zh": "y"}, {"title_en": "B", "title_zh": "乙", "body_en": "z", "body_zh": "w"}]}'
  grep -qF 'cards-2' <<< "$output"
  grep -qF 'class="card"' <<< "$output"
}

@test "cards-3.html output contains cards-3 class" {
  run run_partial "cards-3.html" '{"cards": [{"title_en": "A", "title_zh": "甲", "body_en": "x", "body_zh": "y"}, {"title_en": "B", "title_zh": "乙", "body_en": "z", "body_zh": "w"}, {"title_en": "C", "title_zh": "丙", "body_en": "q", "body_zh": "r"}]}'
  grep -qF 'cards-3' <<< "$output"
}

@test "cards-4.html output contains cards-4 class" {
  run run_partial "cards-4.html" '{"cards": [{"title_en": "A", "title_zh": "甲", "body_en": "x", "body_zh": "y"}, {"title_en": "B", "title_zh": "乙", "body_en": "z", "body_zh": "w"}, {"title_en": "C", "title_zh": "丙", "body_en": "q", "body_zh": "r"}, {"title_en": "D", "title_zh": "丁", "body_en": "s", "body_zh": "t"}]}'
  grep -qF 'cards-4' <<< "$output"
}

@test "compare.html output contains compare-before and compare-after classes" {
  run run_partial "compare.html" '{"left_title_en": "Before", "left_title_zh": "之前", "right_title_en": "After", "right_title_zh": "之后", "left_items": [{"text_en": "bad", "text_zh": "坏"}], "right_items": [{"text_en": "good", "text_zh": "好"}]}'
  grep -qF 'compare-before' <<< "$output"
  grep -qF 'compare-after' <<< "$output"
  grep -qF 'compare-arrow' <<< "$output"
}

@test "pipeline.html output contains pipe-stage and pipe- classes" {
  run run_partial "pipeline.html" '{"stages": [{"title_en": "Idea", "title_zh": "想法", "desc_en": "capture", "desc_zh": "捕捉", "css_class": "pipe-idea"}, {"title_en": "Build", "title_zh": "构建", "desc_en": "ship", "desc_zh": "交付", "css_class": "pipe-build"}]}'
  grep -qF 'pipeline-bar' <<< "$output"
  grep -qF 'pipe-stage' <<< "$output"
}

@test "timeline.html output contains timeline and timeline-item classes" {
  run run_partial "timeline.html" '{"items": [{"title_en": "S1", "title_zh": "一", "body_en": "x", "body_zh": "y"}]}'
  grep -qF 'class="timeline"' <<< "$output"
  grep -qF 'timeline-item' <<< "$output"
}

@test "quote.html output contains quote-block class" {
  run run_partial "quote.html" '{"text_en": "Q", "text_zh": "引"}'
  grep -qF 'quote-block' <<< "$output"
}

@test "highlight.html output contains highlight-box class" {
  run run_partial "highlight.html" '{"body_en": "<p>Hi</p>", "body_zh": "<p>嘿</p>"}'
  grep -qF 'highlight-box' <<< "$output"
}
