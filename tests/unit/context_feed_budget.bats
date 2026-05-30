#!/usr/bin/env bats
# US-CTX-001: Unit tests for the context-feed budget (投喂预算).
# Covers: full vs over-budget plan, summarize/chunk over budget, explicit
# non-silent annotation, configurable threshold, and the log line carrying
# actual size + strategy.

load helpers
setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# Helper: write a file of N bytes (A repeated, newline-terminated lines).
_mk_file() {
  local path="$1" bytes="$2"
  : > "$path"
  local line="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"  # 50 chars
  local written=0
  while [ "$written" -lt "$bytes" ]; do
    printf '%s\n' "$line" >> "$path"
    written=$((written + 51))
  done
}

@test "budget defaults to compiled-in value when env unset" {
  unset ROLL_FEED_BUDGET_BYTES
  run _feed_budget_bytes
  [ "$status" -eq 0 ]
  [ "$output" = "$ROLL_FEED_BUDGET_DEFAULT_BYTES" ]
}

@test "budget threshold is configurable via ROLL_FEED_BUDGET_BYTES" {
  ROLL_FEED_BUDGET_BYTES=4096 run _feed_budget_bytes
  [ "$output" = "4096" ]
}

@test "non-numeric / non-positive budget falls back to default" {
  ROLL_FEED_BUDGET_BYTES=abc run _feed_budget_bytes
  [ "$output" = "$ROLL_FEED_BUDGET_DEFAULT_BYTES" ]
  ROLL_FEED_BUDGET_BYTES=0 run _feed_budget_bytes
  [ "$output" = "$ROLL_FEED_BUDGET_DEFAULT_BYTES" ]
}

@test "within-budget feature → full plan" {
  _mk_file small.md 200
  ROLL_FEED_BUDGET_BYTES=8192 run _feed_plan small.md
  [ "$output" = "full" ]
}

@test "over-budget feature → summarized plan" {
  _mk_file big.md 2000
  ROLL_FEED_BUDGET_BYTES=1024 run _feed_plan big.md
  [ "$output" = "summarized" ]
}

@test "far-over-budget feature → chunked plan" {
  _mk_file huge.md 6000
  ROLL_FEED_BUDGET_BYTES=1024 run _feed_plan huge.md
  [ "$output" = "chunked" ]
}

@test "within-budget assemble injects the full file content" {
  printf 'line-one\nline-two\n' > small.md
  ROLL_FEED_BUDGET_BYTES=8192 run _feed_assemble small.md
  [[ "$output" == *"line-one"* ]]
  [[ "$output" == *"line-two"* ]]
  # No summary/chunk notice when full.
  [[ "$output" != *"context-feed"* ]]
}

@test "over-budget assemble carries an explicit non-silent notice + full-text path" {
  _mk_file big.md 4000
  ROLL_FEED_BUDGET_BYTES=1024 run _feed_assemble big.md
  # AC: not silent — explicit annotation present, both EN and ZH.
  [[ "$output" == *"summarized"* ]] || [[ "$output" == *"摘要"* ]]
  [[ "$output" == *"big.md"* ]]              # full-text path pointer
  [[ "$output" == *"全文见"* ]]               # ZH annotation
}

@test "far-over-budget assemble is annotated as chunked, not silent" {
  _mk_file huge.md 8000
  ROLL_FEED_BUDGET_BYTES=1024 run _feed_assemble huge.md
  [[ "$output" == *"CHUNKS"* ]] || [[ "$output" == *"分段"* ]]
  [[ "$output" == *"huge.md"* ]]
}

@test "summarized material fits within budget head (does not hard-stuff whole file)" {
  _mk_file big.md 4000
  ROLL_FEED_BUDGET_BYTES=1024 _feed_assemble big.md > out.txt
  # The injected material must be materially smaller than the raw 4000-byte file.
  local raw injected
  raw=$(wc -c < big.md | tr -d ' ')
  injected=$(wc -c < out.txt | tr -d ' ')
  [ "$injected" -lt "$raw" ]
}

@test "log line records actual injected bytes (bounded) + chosen strategy" {
  _mk_file big.md 4000
  ROLL_FEED_BUDGET_BYTES=1024 run _feed_log_line big.md summarized
  [[ "$output" == *"strategy=summarized"* ]]
  [[ "$output" == *"budget=1024"* ]]
  [[ "$output" == *"file=big.md"* ]]
  # AC: actual INJECTED volume is logged — bounded, not the 4000-byte source.
  local injected
  injected=$(printf '%s' "$output" | sed -E 's/.*bytes=([0-9]+).*/\1/')
  [ "$injected" -lt 4000 ]
}

@test "log line for a full (within-budget) file records the source size" {
  _mk_file small.md 200
  ROLL_FEED_BUDGET_BYTES=8192 run _feed_log_line small.md
  [[ "$output" == *"strategy=full"* ]]
  local injected
  injected=$(printf '%s' "$output" | sed -E 's/.*bytes=([0-9]+).*/\1/')
  [ "$injected" -ge 200 ]
}

@test "chunked plan emits a real chunk header with chunk count N>1" {
  _mk_file huge.md 8000
  ROLL_FEED_BUDGET_BYTES=1024 run _feed_chunk huge.md
  [[ "$output" == *"chunk 1/"* ]]
  local n
  n=$(printf '%s' "$output" | sed -E 's@.*chunk 1/([0-9]+).*@\1@' | head -1)
  [ "$n" -gt 1 ]
}

@test "budget head keeps content even for a single long unterminated line" {
  printf 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' > oneline.md   # 40 bytes, no newline
  ROLL_FEED_BUDGET_BYTES=16 run _feed_budget_head oneline.md
  # Must not be silently emptied — falls back to the raw byte head.
  [ -n "$output" ]
}

@test "log line derives plan when strategy arg omitted" {
  _mk_file small.md 200
  ROLL_FEED_BUDGET_BYTES=8192 run _feed_log_line small.md
  [[ "$output" == *"strategy=full"* ]]
}

@test "missing file → size 0, full plan, empty assemble" {
  run _feed_size_bytes /no/such/file.md
  [ "$output" = "0" ]
  run _feed_plan /no/such/file.md
  [ "$output" = "full" ]
  run _feed_assemble /no/such/file.md
  [ -z "$output" ]
}
