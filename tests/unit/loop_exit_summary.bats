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
