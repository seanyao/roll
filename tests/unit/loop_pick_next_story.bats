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

@test "pick_next (FIX-141): skips a story that already has an open PR" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | first | 📋 Todo |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | second | 📋 Todo |
MD
  # Stub gh so `gh pr list ... --jq '.[].title'` reports an open PR for A-001.
  mkdir -p "$TEST_TMP/binstub"
  printf '#!/bin/bash\necho "FIX-A-001: some open PR"\n' > "$TEST_TMP/binstub/gh"
  chmod +x "$TEST_TMP/binstub/gh"
  source "$ROLL"
  PATH="$TEST_TMP/binstub:$PATH"
  run _loop_pick_next_story
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-A-002" ]   # A-001 skipped (open PR), A-002 picked
}

@test "pick_next (FIX-141): no gh / no open PRs → normal pick (no skipping)" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | first | 📋 Todo |
MD
  mkdir -p "$TEST_TMP/binstub"
  printf '#!/bin/bash\nexit 0\n' > "$TEST_TMP/binstub/gh"   # empty PR list
  chmod +x "$TEST_TMP/binstub/gh"
  source "$ROLL"
  PATH="$TEST_TMP/binstub:$PATH"
  run _loop_pick_next_story
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-A-001" ]
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

# FIX-146: _loop_story_is_eligible tests ─────────────────────────────────────

@test "story_is_eligible: 📋 Todo story with no blockers → eligible" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | plain | 📋 Todo |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-001"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "story_is_eligible: ✅ Done story → ineligible" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | done | ✅ Done |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-001"
  [ "$status" -ne 0 ]
}

@test "story_is_eligible: manual-only → ineligible" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | reserved manual-only:true | 📋 Todo |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-001"
  [ "$status" -ne 0 ]
}

@test "story_is_eligible: unsatisfied depends-on → ineligible" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | parent | 🔨 In Progress |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | child depends-on:FIX-A-001 | 📋 Todo |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-002"
  [ "$status" -ne 0 ]
}

@test "story_is_eligible: satisfied depends-on → eligible" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | parent | ✅ Done |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | child depends-on:FIX-A-001 | 📋 Todo |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-002"
  [ "$status" -eq 0 ]
}

@test "story_is_eligible: open PR titles provided → ineligible when matched" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | first | 📋 Todo |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-001" ".roll/backlog.md" "FIX-A-001: some open PR"
  [ "$status" -ne 0 ]
}

@test "story_is_eligible: open PR titles provided → eligible when not matched" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | first | 📋 Todo |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-001" ".roll/backlog.md" "FIX-A-999: unrelated PR"
  [ "$status" -eq 0 ]
}

@test "story_is_eligible: missing story id → ineligible" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | plain | 📋 Todo |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-999"
  [ "$status" -ne 0 ]
}

@test "story_is_eligible: missing backlog file → ineligible" {
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-001" ".roll/missing.md"
  [ "$status" -ne 0 ]
}

@test "story_is_eligible: _loop_pick_next_story delegates to it (behavior unchanged)" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | manual manual-only:true | 📋 Todo |
| [FIX-A-002](.roll/features/test/t.md#fix-a-002) | plain | 📋 Todo |
MD
  source "$ROLL"
  run _loop_pick_next_story
  [ "$status" -eq 0 ]
  [ "$output" = "FIX-A-002" ]
}

# FIX-161: story description containing another story's id or 📋 Todo must not
# cause false positives in either eligibility gate or id extraction.
@test "story_is_eligible: ✅ Done story with 📋 Todo in description → ineligible" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | reverts to 📋 Todo on failure | ✅ Done |
MD
  source "$ROLL"
  run _loop_story_is_eligible "FIX-A-001"
  [ "$status" -ne 0 ]
}

@test "pick_next: does not extract story ID from description column" {
  write_backlog <<'MD'
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | mentions US-A-002 in description manual-only:true | 📋 Todo |
| [US-A-002](.roll/features/test/t.md#us-a-002) | reverts to 📋 Todo on failure | ✅ Done |
MD
  source "$ROLL"
  run _loop_pick_next_story
  # With the bug, US-A-002 would be extracted from FIX-A-001's description
  # and returned as eligible (because US-A-002's own description contains
  # 📋 Todo, fooling the gate). After the fix, no eligible story remains.
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# FIX-146: inner script template includes the re-validation guard
@test "runner script: FIX-146 inner includes TOCTOU re-validation guard" {
  source "$ROLL"
  _write_loop_runner_script "${TEST_TMP}/run-fix146.sh" "${TEST_TMP}" "echo ok" "${TEST_TMP}/log" 0 24 >/dev/null 2>&1 || true
  local inner="${TEST_TMP}/run-fix146-inner.sh"
  [ -f "$inner" ]
  grep -qF '_loop_story_is_eligible' "$inner"
  grep -qF 'story_stale' "$inner"
  grep -qF 're-picking' "$inner"
}
