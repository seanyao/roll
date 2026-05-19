#!/usr/bin/env bats
# E2E integration tests for: bare `roll` invocation (dashboard golden path).
# Companion to unit-level tests/unit/roll_dashboard.bats — this file runs the
# binary as a user would (no args, real subprocess) to catch wiring/regression.

load helpers

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  integration_setup
  # Minimal git repo so _dash_git_status works inside TEST_TMP.
  cd "$TEST_TMP"
  git init -q .
  git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "init"
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
|-------|-------------|--------|
| [US-DEMO-001](.roll/features/demo.md#us-demo-001) | demo todo | 📋 Todo |
| [US-DEMO-002](.roll/features/demo.md#us-demo-002) | demo wip | 🔨 In Progress |
EOF
}

teardown() { integration_teardown; }

@test "roll (no args): v2 home dashboard golden path (US-VIEW-002)" {
  run_roll
  [ "$status" -eq 0 ]
  # Identity row
  [[ "$output" == *"roll ·"* ]]
  [[ "$output" == *"agent"* ]]
  [[ "$output" == *"git"* ]]
  # THREE LAYERS section
  [[ "$output" == *"THREE LAYERS"* ]]
  [[ "$output" == *"Loop"* ]]
  [[ "$output" == *"Dream"* ]]
  [[ "$output" == *"Peer"* ]]
  # FOUR DEFENSES section
  [[ "$output" == *"FOUR DEFENSES"* ]]
  # PIPELINE section
  [[ "$output" == *"PIPELINE"* ]]
  [[ "$output" == *"Ideas"* ]]
  [[ "$output" == *"Backlog"* ]]
  [[ "$output" == *"Build"* ]]
  # CURRENT FOCUS DoD — surfaces in-progress story id
  [[ "$output" == *"CURRENT FOCUS"* ]]
  [[ "$output" == *"US-DEMO-002"* ]]
  # NEED YOU — no alerts → 自驱中
  [[ "$output" == *"NEED YOU"* ]]
  [[ "$output" == *"AI 自驱中"* ]]
  # Quick-nav footer
  [[ "$output" == *"roll --help"* ]]
}

@test "roll (no args): ROLL_UI=v1 falls back to legacy dashboard" {
  ROLL_UI=v1 run_roll
  [ "$status" -eq 0 ]
  # Legacy dashboard markers (three layers as "Layer" rows, ASCII frame)
  [[ "$output" == *"Loop Layer"* ]] || [[ "$output" == *"Dream Layer"* ]]
}

@test "roll (no args): degrades gracefully when no .roll/backlog.md" {
  rm .roll/backlog.md
  run_roll
  [ "$status" -eq 0 ]
  # Without .roll/backlog.md main() falls through to _help + changelog.
  # v2: "roll ·" wordmark + AUTONOMY; v1: "Usage:" or "用法"
  [[ "$output" == *"roll ·"* ]] || [[ "$output" == *"AUTONOMY"* ]] \
    || [[ "$output" == *"Usage:"* ]] || [[ "$output" == *"用法"* ]]
}
