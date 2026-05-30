#!/usr/bin/env bats
# Unit tests for US-LOOP-040: the .command exit summary renderer.
# Covers lib/loop-exit-summary.py (the rendering helper) plus the
# _loop_render_exit_summary bash dispatcher that wires it to project-local
# loop data. Three input classes per AC: complete runs.jsonl row / idle row /
# missing files.

load helpers

setup() {
  unit_setup_cd
  RENDERER="${ROLL_PKG_DIR}/lib/loop-exit-summary.py"
  RT="${TEST_TMP}/.roll/loop"
  mkdir -p "$RT"
}
teardown() { unit_teardown_cd; }

# Run the python renderer directly with explicit paths.
_render() {
  python3 "$RENDERER" "$@"
}

# ── lib renderer: complete runs.jsonl row ────────────────────────────────────

@test "renderer: complete row prints built + tcr + ci + todo + phases" {
  printf '%s\n' '{"status":"done","cycle_id":"c1","built":["US-LOOP-040"],"tcr_count":4,"phases":{"agent_invoke":300,"cleanup":2}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"ok"}' > "${RT}/events.ndjson"
  printf '%s\n' '- US-A 📋 Todo' '- US-B 📋 Todo' '- US-C ✅ Done' > "${TEST_TMP}/backlog.md"

  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --backlog "${TEST_TMP}/backlog.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"─── Cycle c1 Summary ───"* ]]
  [[ "$output" == *"built: US-LOOP-040 · tcr commits: 4"* ]]
  [[ "$output" == *"ci: green"* ]]
  [[ "$output" == *"todo remaining: 2"* ]]
  [[ "$output" == *"agent_invoke"* ]]
}

@test "renderer: ci red passes through as red" {
  printf '%s\n' '{"status":"failed","cycle_id":"c1","built":[],"tcr_count":0,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"red"}' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ci: red"* ]]
}

@test "renderer: no ci event renders ci: n/a" {
  printf '%s\n' '{"status":"done","cycle_id":"c1","built":["US-X"],"tcr_count":1,"phases":{}}' > "${RT}/runs.jsonl"
  : > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ci: n/a"* ]]
}

# ── lib renderer: idle row ───────────────────────────────────────────────────

@test "renderer: idle row prints 'idle: no story picked'" {
  printf '%s\n' '{"status":"idle","cycle_id":"c2","built":[],"tcr_count":0,"phases":{}}' > "${RT}/runs.jsonl"
  run _render --runs "${RT}/runs.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"─── Cycle c2 Summary ───"* ]]
  [[ "$output" == *"idle: no story picked"* ]]
}

# ── lib renderer: missing files ──────────────────────────────────────────────

@test "renderer: all sources missing prints 'summary unavailable'" {
  run _render --runs "${RT}/nope.jsonl" --events "${RT}/nope.ndjson" --cron-log "${RT}/nope.log"
  [ "$status" -eq 0 ]
  [[ "$output" == *"(summary unavailable — see log:"* ]]
}

@test "renderer: falls back to cron log tail when runs+events absent" {
  printf '%s\n' 'cron line A' 'cron line B' > "${RT}/cron.log"
  run _render --runs "${RT}/nope.jsonl" --events "${RT}/nope.ndjson" --cron-log "${RT}/cron.log"
  [ "$status" -eq 0 ]
  [[ "$output" == *"cron line A"* ]]
  [[ "$output" == *"cron line B"* ]]
}

@test "renderer: corrupt JSON does not crash, exits 0" {
  printf '%s\n' 'this is not json {{{' > "${RT}/runs.jsonl"
  printf '%s\n' 'also not json' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --cron-log "${RT}/missing.log"
  [ "$status" -eq 0 ]
  # No parseable row AND no events AND no cron log → unavailable placeholder.
  [[ "$output" == *"summary unavailable"* ]]
}

# ── bash dispatcher: _loop_render_exit_summary ───────────────────────────────

@test "dispatcher: resolves project-local data via ROLL_PROJECT_RUNTIME_DIR" {
  printf '%s\n' '{"status":"done","cycle_id":"c9","built":["US-LOOP-040"],"tcr_count":3,"phases":{"agent_invoke":120}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"ok"}' > "${RT}/events.ndjson"
  printf '%s\n' '- US-A 📋 Todo' > "${TEST_TMP}/.roll/backlog.md"

  ROLL_PROJECT_RUNTIME_DIR="$RT" run _loop_render_exit_summary "some-slug" "c9"
  [ "$status" -eq 0 ]
  [[ "$output" == *"─── Cycle c9 Summary ───"* ]]
  [[ "$output" == *"built: US-LOOP-040 · tcr commits: 3"* ]]
}

@test "dispatcher: missing slug returns 0 with no output" {
  run _loop_render_exit_summary ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "dispatcher: missing renderer script is silent (exit 0)" {
  # Point ROLL_PKG_DIR at an empty dir so the renderer cannot be found.
  ROLL_PKG_DIR="${TEST_TMP}/empty" ROLL_PROJECT_RUNTIME_DIR="$RT" run _loop_render_exit_summary "some-slug"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "main() dispatches _loop_render_exit_summary subcommand" {
  grep -qE '_loop_render_exit_summary\)[[:space:]]+_loop_render_exit_summary' "$ROLL_BIN"
}

# ── US-LOOP-041: failure / alert highlighting ────────────────────────────────
# ESC byte for asserting (or refuting) ANSI escapes in captured output.
ESC=$'\033'

# --- FAIL state ---------------------------------------------------------------

@test "highlight: failed status gets ✗ prefix (plain in pipe / --color never)" {
  printf '%s\n' '{"status":"failed","cycle_id":"f1","built":[],"tcr_count":0,"phases":{}}' > "${RT}/runs.jsonl"
  run _render --runs "${RT}/runs.jsonl" --color never
  [ "$status" -eq 0 ]
  [[ "$output" == *"✗ failed"* ]]
  [[ "$output" != *"$ESC"* ]]
}

@test "highlight: failed status emits red ANSI with --color always (TTY mode)" {
  printf '%s\n' '{"status":"failed","cycle_id":"f1","built":[],"tcr_count":0,"phases":{}}' > "${RT}/runs.jsonl"
  run _render --runs "${RT}/runs.jsonl" --color always
  [ "$status" -eq 0 ]
  [[ "$output" == *"${ESC}[31m"* ]]
  [[ "$output" == *"✗ failed"* ]]
}

@test "highlight: ci red flags the ci line as ✗ fail" {
  printf '%s\n' '{"status":"done","cycle_id":"f2","built":["US-X"],"tcr_count":2,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"red"}' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --color never
  [ "$status" -eq 0 ]
  [[ "$output" == *"✗ ci: red"* ]]
}

@test "highlight: cycle_end outcome != ok/idle flags result as fail" {
  printf '%s\n' '{"status":"done","cycle_id":"f3","built":["US-X"],"tcr_count":2,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"cycle_end","outcome":"error"}' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --color always
  [ "$status" -eq 0 ]
  [[ "$output" == *"${ESC}[31m"* ]]
  [[ "$output" == *"✗ built: US-X"* ]]
}

# --- WARN state ---------------------------------------------------------------

@test "highlight: ci heal-attempting gets ⚠ prefix (plain --color never)" {
  printf '%s\n' '{"status":"done","cycle_id":"w1","built":["US-X"],"tcr_count":2,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"heal-attempting"}' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --color never
  [ "$status" -eq 0 ]
  [[ "$output" == *"⚠ ci: heal-attempting"* ]]
  [[ "$output" != *"$ESC"* ]]
}

@test "highlight: ci heal-attempting emits yellow ANSI with --color always" {
  printf '%s\n' '{"status":"done","cycle_id":"w1","built":["US-X"],"tcr_count":2,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"heal-attempting"}' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --color always
  [ "$status" -eq 0 ]
  [[ "$output" == *"${ESC}[33m"* ]]
  [[ "$output" == *"⚠ ci: heal-attempting"* ]]
}

@test "highlight: tcr_count==0 with non-empty built[] is zero-diff ⚠ warn" {
  printf '%s\n' '{"status":"done","cycle_id":"w2","built":["US-X"],"tcr_count":0,"phases":{}}' > "${RT}/runs.jsonl"
  run _render --runs "${RT}/runs.jsonl" --color never
  [ "$status" -eq 0 ]
  [[ "$output" == *"⚠ built: US-X · tcr commits: 0"* ]]
}

@test "highlight: non-empty ALERT file raises a ⚠ alert line" {
  printf '%s\n' '{"status":"done","cycle_id":"w3","built":["US-X"],"tcr_count":2,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' 'persistent failure: 3 retries' > "${RT}/ALERT-some-slug.md"
  run _render --runs "${RT}/runs.jsonl" --alert "${RT}/ALERT-some-slug.md" --color never
  [ "$status" -eq 0 ]
  [[ "$output" == *"⚠ alert: ALERT file active"* ]]
}

@test "highlight: empty ALERT file does NOT raise an alert line" {
  printf '%s\n' '{"status":"done","cycle_id":"w3","built":["US-X"],"tcr_count":2,"phases":{}}' > "${RT}/runs.jsonl"
  : > "${RT}/ALERT-some-slug.md"
  run _render --runs "${RT}/runs.jsonl" --alert "${RT}/ALERT-some-slug.md" --color never
  [ "$status" -eq 0 ]
  [[ "$output" != *"alert: ALERT file active"* ]]
}

# --- GREEN state --------------------------------------------------------------

@test "highlight: fully green cycle has no prefix and no ANSI even with --color always" {
  printf '%s\n' '{"status":"done","cycle_id":"g1","built":["US-X"],"tcr_count":3,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"ok"}' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --color always
  [ "$status" -eq 0 ]
  [[ "$output" == *"built: US-X · tcr commits: 3"* ]]
  [[ "$output" == *"ci: green"* ]]
  [[ "$output" != *"✗"* ]]
  [[ "$output" != *"⚠"* ]]
  [[ "$output" != *"$ESC"* ]]
}

@test "highlight: green cycle in pipe mode (--color never) stays plain text" {
  printf '%s\n' '{"status":"done","cycle_id":"g1","built":["US-X"],"tcr_count":3,"phases":{}}' > "${RT}/runs.jsonl"
  printf '%s\n' '{"stage":"ci","outcome":"ok"}' > "${RT}/events.ndjson"
  run _render --runs "${RT}/runs.jsonl" --events "${RT}/events.ndjson" --color never
  [ "$status" -eq 0 ]
  [[ "$output" != *"$ESC"* ]]
}

# --- NO_COLOR + auto-detect ---------------------------------------------------

@test "highlight: NO_COLOR=1 forces plain text even with status=failed" {
  printf '%s\n' '{"status":"failed","cycle_id":"n1","built":[],"tcr_count":0,"phases":{}}' > "${RT}/runs.jsonl"
  NO_COLOR=1 run _render --runs "${RT}/runs.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"✗ failed"* ]]
  [[ "$output" != *"$ESC"* ]]
}

@test "highlight: auto mode under capture (non-TTY) emits no ANSI" {
  printf '%s\n' '{"status":"failed","cycle_id":"n2","built":[],"tcr_count":0,"phases":{}}' > "${RT}/runs.jsonl"
  run _render --runs "${RT}/runs.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" != *"$ESC"* ]]
}
