#!/usr/bin/env bats
# FIX-127: CJK topic slug fallback for roll slides new

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── _slides_topic_slug regression (ASCII) ─────────────────────────────────

@test "FIX-127: _slides_topic_slug with pure ASCII" {
  run _slides_topic_slug "game guide"
  [[ "$status" -eq 0 ]]
  [[ "$output" == "game-guide" ]]
}

@test "FIX-127: _slides_topic_slug with ASCII and punctuation" {
  run _slides_topic_slug "Hello, World!"
  [[ "$status" -eq 0 ]]
  [[ "$output" == "hello-world" ]]
}

@test "FIX-127: _slides_topic_slug with leading/trailing special chars" {
  run _slides_topic_slug "  --hello world--  "
  [[ "$status" -eq 0 ]]
  [[ "$output" == "hello-world" ]]
}

# ─── _slides_topic_slug with CJK (current behavior — produces short/empty) ──

@test "FIX-127: _slides_topic_slug with pure CJK returns empty or short" {
  run _slides_topic_slug "游戏指南"
  [[ "$status" -eq 0 ]]
  # Current behavior: all CJK chars are filtered out, leaving empty or single '-'
  [[ "$output" == "" || "$output" == "-" ]]
}

@test "FIX-127: _slides_topic_slug with mixed CJK+ASCII" {
  run _slides_topic_slug "Mixed 中文 Title"
  [[ "$status" -eq 0 ]]
  # CJK chars stripped, ASCII kept → "mixed--title" (double dash) or similar
  [[ "$output" == "mixed-title" || "$output" == "mixed--title" ]]
}

# ─── _slides_topic_slug_fallback ────────────────────────────────────────────

@test "FIX-127: _slides_topic_slug_fallback is deterministic" {
  run _slides_topic_slug_fallback "游戏指南"
  [[ "$status" -eq 0 ]]
  local first="$output"

  run _slides_topic_slug_fallback "游戏指南"
  [[ "$status" -eq 0 ]]
  [[ "$output" == "$first" ]]
}

@test "FIX-127: _slides_topic_slug_fallback format is deck-YYYYMMDD-hash" {
  run _slides_topic_slug_fallback "游戏指南"
  [[ "$status" -eq 0 ]]
  # Format: deck-YYYYMMDD-<4 hex chars>
  [[ "$output" =~ ^deck-[0-9]{8}-[a-f0-9]{4}$ ]]
}

@test "FIX-127: _slides_topic_slug_fallback different topics get different hashes" {
  run _slides_topic_slug_fallback "游戏指南"
  local slug1="$output"

  run _slides_topic_slug_fallback "其他主题"
  local slug2="$output"

  # Same date, different hash
  [[ "${slug1%-*}" == "${slug2%-*}" ]]  # same deck-YYYYMMDD prefix
  [[ "${slug1##*-}" != "${slug2##*-}" ]] # different hash
}

# ─── cmd_slides_new --slug validation ───────────────────────────────────────

@test "FIX-127: cmd_slides_new --slug with valid slug" {
  run cmd_slides_new "游戏指南" --slug "game-guide"
  # Will reach agent invocation and fail (no agent in test), but should
  # not fail on slug validation — look for agent-related error, not slug error
  [[ "$output" != *"slug"* || "$output" == *"agent"* || "$output" == *"Agent"* || "$output" == *"Unknown"* ]]
}

@test "FIX-127: cmd_slides_new --slug with uppercase rejects" {
  run cmd_slides_new "游戏指南" --slug "Game-Guide"
  [[ "$status" -ne 0 ]]
  [[ "$output" == *"slug"* || "$output" == *"Invalid"* || "$output" == *"a-z"* ]]
}

@test "FIX-127: cmd_slides_new --slug with spaces rejects" {
  run cmd_slides_new "游戏指南" --slug "game guide"
  [[ "$status" -ne 0 ]]
}

@test "FIX-127: cmd_slides_new --slug with non-ASCII rejects" {
  run cmd_slides_new "游戏指南" --slug "游戏指南"
  [[ "$status" -ne 0 ]]
}

@test "FIX-127: cmd_slides_new --slug requires value" {
  run cmd_slides_new "游戏指南" --slug
  [[ "$status" -ne 0 ]]
}

@test "FIX-127: cmd_slides_new CJK topic without --slug uses fallback" {
  run cmd_slides_new "游戏指南"
  # Should not output "Could not derive a slug"
  [[ "$output" != *"Could not derive a slug"* ]]
  # Should show fallback slug hint
  [[ "$output" == *"slug"* || "$output" == *"deck-"* ]]
}
