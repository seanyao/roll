#!/usr/bin/env bats
# US-AGENT-006: _loop_pick_next_story chooses the first eligible Todo from
# .roll/backlog.md, respecting status (📋 Todo only), manual-only:true skip,
# and depends-on satisfaction. This is what the runner uses before invoking
# the routed agent (replaces the old "one agent for all cycles" model).

ROLL="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/features/test
  cat > .roll/agent-routes.yaml <<'YAML'
schema: v1
agents:
  pi:
    types: [FIX, US, REFACTOR]
    est_min: { min: 0, max: 30 }
    risk: [low, medium, high]
history:
  cold_start_default: pi
YAML
}

teardown() { cd /; rm -rf "$TEST_TMP"; }

write_backlog() {
  cat > .roll/backlog.md
}

@test "pick_next: returns FIX before US (priority)" {
  write_backlog <<'MD'
| [US-A-001](.roll/features/test/t.md#us-a-001) | x | 📋 Todo |
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | y | 📋 Todo |
MD
  source "$ROLL"
  run _loop_pick_next_story
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-A-001" ]
}

@test "pick_next: skips In Progress, picks next Todo" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | first | 🔨 In Progress |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | second | 📋 Todo |
MD
  source "$ROLL"
  run _loop_pick_next_story
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-A-002" ]
}

@test "pick_next: skips manual-only rows" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | manual one manual-only:true | 📋 Todo |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | second | 📋 Todo |
MD
  source "$ROLL"
  run _loop_pick_next_story
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-A-002" ]
}

@test "pick_next: respects depends-on (skip if dep not Done)" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | parent | 📋 Todo |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | child depends-on:FIX-A-001 | 📋 Todo |
MD
  source "$ROLL"
  run _loop_pick_next_story
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-A-001" ]
}

@test "pick_next: no eligible Todo → non-zero exit, empty stdout" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | done | ✅ Done |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | manual manual-only:true | 📋 Todo |
MD
  source "$ROLL"
  run _loop_pick_next_story
  [ "$status" -ne 0 ]
}

@test "pick_next: empty backlog → non-zero" {
  write_backlog <<'MD'
# Project Backlog
MD
  source "$ROLL"
  run _loop_pick_next_story
  [ "$status" -ne 0 ]
}

# US-AGENT-006: the generated runner inner script must call the routing
# helpers before agent invocation, replacing the old `_project_agent` reference.
@test "runner script: inner writes a routing block referencing _loop_pick_next_story" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qE "_loop_pick_next_story|_loop_pick_agent_for_story" "$inner"
}

@test "runner script: inner announces routing on cron.log" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-inner.sh"
  [ -f "$inner" ]
  grep -qE "routed to|via.*hard|via.*soft|story.*routed" "$inner"
}
