#!/usr/bin/env bash
# US-CTX-001: Context-feed budget (投喂预算).
#
# roll is an outer orchestrator: when it builds the inner agent's prompt it
# injects material — chiefly the story's feature .md file. Large stories used to
# be fed whole ("整文件硬塞"), which can blow the inner agent's context window.
#
# This module is the ContextFeed aggregate. It owns FeedBudget (a max byte size,
# configurable) and decides an InjectionPlan (full / summarized / chunked) for a
# given piece of material — never silently truncating, always annotating when it
# summarizes or chunks and always pointing at the full-text path.
#
# Boundary: token-level compression stays in the inner agent harness. This module
# only answers "what to feed, and how much".
#
# Pure bash 3.2: no ${var^^}, no mapfile, no declare -A. All functions read from
# args / env and write to stdout — no global state, no file writes.

# Default feed budget in bytes. Tuned to comfortably hold a normal story feature
# file while staying well under an inner agent's context window. Configurable via
# ROLL_FEED_BUDGET_BYTES so operators can dial it to the inner agent's capacity.
ROLL_FEED_BUDGET_DEFAULT_BYTES=16384

# _feed_budget_bytes
# Resolve the active feed budget (bytes). Honors ROLL_FEED_BUDGET_BYTES when set
# to a positive integer; otherwise falls back to the compiled-in default.
_feed_budget_bytes() {
  local v="${ROLL_FEED_BUDGET_BYTES:-}"
  case "$v" in
    ''|*[!0-9]*) echo "$ROLL_FEED_BUDGET_DEFAULT_BYTES" ;;
    *) if [ "$v" -gt 0 ]; then echo "$v"; else echo "$ROLL_FEED_BUDGET_DEFAULT_BYTES"; fi ;;
  esac
}

# _feed_size_bytes <file>
# Byte size of a file. Echoes 0 for a missing/unreadable file.
_feed_size_bytes() {
  local f="$1"
  [ -f "$f" ] || { echo 0; return 0; }
  # wc -c is portable across macOS bash 3.2 and Linux; strip leading spaces.
  local n
  n=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  case "$n" in
    ''|*[!0-9]*) echo 0 ;;
    *) echo "$n" ;;
  esac
}

# _feed_plan <file>
# Decide the InjectionPlan for a material file: prints one of
#   full | summarized | chunked
# - Within budget            → full
# - Over budget              → summarized
# - Over 4x budget (huge)    → chunked
# A missing file is treated as full (nothing to budget).
_feed_plan() {
  local f="$1"
  local size budget
  size=$(_feed_size_bytes "$f")
  budget=$(_feed_budget_bytes)
  if [ "$size" -le "$budget" ]; then
    echo full
  elif [ "$size" -le "$((budget * 4))" ]; then
    echo summarized
  else
    echo chunked
  fi
}

# _feed_summary_notice <file> <plan>
# The explicit, non-silent annotation prepended to summarized/chunked material.
# Bilingual per project convention: EN and ZH on separate lines. Points at the
# full-text path so nothing is lost. Empty for the `full` plan.
_feed_summary_notice() {
  local f="$1" plan="$2"
  case "$plan" in
    summarized)
      printf '%s\n' "[context-feed] This story feature exceeds the feed budget — injected as a SUMMARY. Full text: ${f}"
      printf '%s\n' "[投喂预算] 本故事 feature 超投喂预算，已摘要注入，全文见 ${f}"
      ;;
    chunked)
      printf '%s\n' "[context-feed] This story feature far exceeds the feed budget — injected in CHUNKS. Full text: ${f}"
      printf '%s\n' "[投喂预算] 本故事 feature 远超投喂预算，已分段注入，全文见 ${f}"
      ;;
    *) : ;;
  esac
}

# _feed_budget_head <file>
# The leading <= budget bytes of <file>, trimmed back to the last COMPLETE line
# so we never cut mid-line silently. Keeps all whole lines that fit; if not even
# the first line fits, falls back to the raw byte head (a single very long line).
# Uses `dd` (not `head -c`) for portability across BSD/macOS and GNU coreutils.
_feed_budget_head() {
  local f="$1"
  local budget
  budget=$(_feed_budget_bytes)
  [ -f "$f" ] || return 0
  local raw
  raw=$(dd bs=1 count="$budget" if="$f" 2>/dev/null)
  # Keep complete lines only. awk prints every line that ended with a newline
  # within the byte window; the trailing partial line (no newline) is dropped.
  # If awk yields nothing (the window is a single unterminated long line), keep
  # the raw head so content is never silently emptied.
  local trimmed
  trimmed=$(printf '%s' "$raw" | awk '{
    if (NR > 1) print buf
    buf = $0
  } END { }')
  if [ -z "$trimmed" ]; then
    printf '%s' "$raw"
  else
    printf '%s\n' "$trimmed"
  fi
}

# _feed_summarize <file>
# Budget-fitting summary: the budget head (complete lines) plus an explicit,
# bilingual elision marker so the omission is never silent. Pure stdout.
_feed_summarize() {
  local f="$1"
  [ -f "$f" ] || return 0
  _feed_budget_head "$f"
  printf '%s\n' "[context-feed] ... summarized: tail elided, full text at the path noted above ..."
  printf '%s\n' "[投喂预算] ……已摘要：尾部内容省略，全文见上方所注路径……"
}

# _feed_chunk_count <file>
# Number of budget-sized chunks the file spans (ceil(size / budget)), min 1.
_feed_chunk_count() {
  local f="$1"
  local size budget
  size=$(_feed_size_bytes "$f")
  budget=$(_feed_budget_bytes)
  [ "$budget" -gt 0 ] || budget=1
  local n=$(( (size + budget - 1) / budget ))
  [ "$n" -lt 1 ] && n=1
  echo "$n"
}

# _feed_chunk <file>
# Inject the FIRST budget-sized chunk (complete lines) with an explicit chunk
# header "chunk 1/N", so the slicing is real and labelled — not a mislabelled
# summary. Remaining chunks live in the full text at the noted path.
_feed_chunk() {
  local f="$1"
  [ -f "$f" ] || return 0
  local n
  n=$(_feed_chunk_count "$f")
  printf '%s\n' "[context-feed] chunk 1/${n} (remaining chunks in full text at the path noted above):"
  printf '%s\n' "[投喂预算] 第 1/${n} 段（其余段见上方所注路径全文）："
  _feed_budget_head "$f"
}

# _feed_assemble <file>
# Top-level injector. Assembles the material to feed for <file> according to the
# active budget + plan, with explicit annotation for non-full plans. Pure stdout;
# callers capture this as the material to splice into the prompt.
_feed_assemble() {
  local f="$1"
  local plan
  plan=$(_feed_plan "$f")
  case "$plan" in
    full)
      [ -f "$f" ] && cat "$f"
      ;;
    summarized)
      _feed_summary_notice "$f" "$plan"
      printf '\n'
      _feed_summarize "$f"
      ;;
    chunked)
      _feed_summary_notice "$f" "$plan"
      printf '\n'
      _feed_chunk "$f"
      ;;
  esac
}

# _feed_log_line <file> <plan>
# A single structured log line recording the actual INJECTED size + chosen
# strategy, for the event log. "Injected" = the byte count _feed_assemble emits
# (for full == source size; for summarized/chunked == the bounded material),
# satisfying the AC's "记录实际注入体积". Format is grep-friendly and stable:
#   context_feed file=<f> strategy=<plan> bytes=<n> budget=<b>
_feed_log_line() {
  local f="$1" plan="${2:-}"
  [ -n "$plan" ] || plan=$(_feed_plan "$f")
  local bytes budget
  budget=$(_feed_budget_bytes)
  bytes=$(_feed_assemble "$f" | wc -c | tr -d ' ')
  case "$bytes" in ''|*[!0-9]*) bytes=0 ;; esac
  printf 'context_feed file=%s strategy=%s bytes=%s budget=%s\n' "$f" "$plan" "$bytes" "$budget"
}
