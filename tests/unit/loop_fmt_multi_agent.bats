#!/usr/bin/env bats
# Unit tests for lib/loop-fmt.py multi-agent transparent forwarding (US-LOOP-010)

LOOP_FMT="${BATS_TEST_DIRNAME}/../../lib/loop-fmt.py"

setup() {
  TEST_TMP="$(mktemp -d)"
  export LOOP_PROJECT_SLUG="test-slug"
  export LOOP_CYCLE_ID="test-cycle-001"
  export LOOP_SHARED_ROOT="$TEST_TMP"
  mkdir -p "$TEST_TMP/loop"
}
teardown() { rm -rf "${TEST_TMP:-}"; }

run_fmt_with_agent() {
  local agent="$1"; shift
  export ROLL_LOOP_AGENT="$agent"
  echo "$1" | python3 "$LOOP_FMT"
}

strip_ansi() {
  sed 's/\x1b\[[0-9;]*m//g'
}

# ─── Transparent forwarding ─────────────────────────────────────────────────

@test "US-LOOP-010: pi agent → text line forwarded with timestamp prefix" {
  run run_fmt_with_agent "pi" "Hello from pi agent"
  [ "$status" -eq 0 ]
  # Should contain the original text (stripped of ANSI)
  stripped=$(echo "$output" | strip_ansi)
  echo "stripped: $stripped"
  [[ "$stripped" == *"Hello from pi agent"* ]]
  # Should contain HH:MM:SS timestamp
  [[ "$stripped" =~ [0-9]{2}:[0-9]{2}:[0-9]{2} ]]
}

@test "US-LOOP-010: deepseek agent → text forwarded with timestamp" {
  run run_fmt_with_agent "deepseek" "Analyzing codebase..."
  [ "$status" -eq 0 ]
  stripped=$(echo "$output" | strip_ansi)
  [[ "$stripped" == *"Analyzing codebase..."* ]]
  [[ "$stripped" =~ [0-9]{2}:[0-9]{2}:[0-9]{2} ]]
}

@test "US-LOOP-010: kimi agent → text forwarded transparently" {
  run run_fmt_with_agent "kimi" "Running tests..."
  [ "$status" -eq 0 ]
  stripped=$(echo "$output" | strip_ansi)
  [[ "$stripped" == *"Running tests..."* ]]
}

@test "US-LOOP-010: multi-line pi output all forwarded" {
  local input=$'line one\nline two\nline three'
  run run_fmt_with_agent "pi" "$input"
  [ "$status" -eq 0 ]
  stripped=$(echo "$output" | strip_ansi)
  [[ "$stripped" == *"line one"* ]]
  [[ "$stripped" == *"line two"* ]]
  [[ "$stripped" == *"line three"* ]]
}

@test "US-LOOP-010: empty lines suppressed in passthrough" {
  run run_fmt_with_agent "pi" ""
  [ "$status" -eq 0 ]
  stripped=$(echo "$output" | strip_ansi)
  # Empty input → nothing output (empty lines suppressed)
  [ -z "$stripped" ]
}

# ─── Claude agent — no regression ───────────────────────────────────────────

@test "US-LOOP-010: claude agent → existing stream-json parser (no regression)" {
  export ROLL_LOOP_AGENT="claude"
  local ev='{"type":"system","subtype":"init","model":"claude-3","tools":[]}'
  run echo "$ev" | python3 "$LOOP_FMT"
  # system events are suppressed (Tier 3) → no output
  [ "${#output}" -eq 0 ]
}

@test "US-LOOP-010: default agent (unset) → claude parser (backward compat)" {
  unset ROLL_LOOP_AGENT
  local ev='{"type":"system","subtype":"init","model":"claude-3","tools":[]}'
  run echo "$ev" | python3 "$LOOP_FMT"
  [ "${#output}" -eq 0 ]
}

# ─── Passthrough is display-only (US-LOOP-026 supersedes US-LOOP-010) ────────
# The realtime passthrough no longer emits usage events: pi -p text mode has
# no usage to scrape, and it ran once per retry → the dashboard's same-label
# SUM inflated tokens ×N. Usage is now written exactly once post-cycle by
# agent_usage/pi_emit.py (see tests/integration/loop_pi_usage_event.bats).

@test "US-LOOP-026: pi passthrough writes NO usage event (display-only)" {
  export ROLL_LOOP_AGENT="pi"
  echo "Working on story..." | python3 "$LOOP_FMT"
  local evfile="$TEST_TMP/loop/events-test-slug.ndjson"
  # No usage event from the realtime path — file is absent or has none.
  if [ -f "$evfile" ]; then
    run grep -c '"stage": "usage"' "$evfile"
    [ "$output" = "0" ]
  fi
}

# ─── Integration: mock agent pipeline ───────────────────────────────────────

@test "US-LOOP-010: multi-line fake pi session produces non-empty tmux output" {
  export ROLL_LOOP_AGENT="pi"
  local tmp_in="$TEST_TMP/fake_pi.txt"
  printf 'I will implement the story.\nReading file...\nWriting tests...\nTests passed!\nCommitting...\n' > "$tmp_in"
  run python3 "$LOOP_FMT" < "$tmp_in"
  [ "$status" -eq 0 ]
  stripped=$(echo "$output" | strip_ansi)
  [ -n "$stripped" ]
  [[ "$stripped" == *"I will implement the story"* ]]
  [[ "$stripped" == *"Reading file"* ]]
  [[ "$stripped" == *"Writing tests"* ]]
  [[ "$stripped" == *"Tests passed"* ]]
  [[ "$stripped" == *"Committing"* ]]
}
