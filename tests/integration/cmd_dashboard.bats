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
  cat > BACKLOG.md <<'EOF'
# Backlog
| Story | Description | Status |
|-------|-------------|--------|
| [US-DEMO-001](docs/features/demo.md#us-demo-001) | demo todo | 📋 Todo |
| [US-DEMO-002](docs/features/demo.md#us-demo-002) | demo wip | 🔨 In Progress |
EOF
}

teardown() { integration_teardown; }

@test "roll (no args): prints six-block dashboard golden path" {
  run_roll
  [ "$status" -eq 0 ]
  # ① Identity row
  [[ "$output" == *"agent"* ]]
  [[ "$output" == *"git"* ]]
  # ② AI 自治 framed block
  [[ "$output" == *"AI 自治"* ]]
  [[ "$output" == *"Loop Layer"* ]]
  [[ "$output" == *"Dream Layer"* ]]
  [[ "$output" == *"Peer Layer"* ]]
  [[ "$output" == *"四道防线"* ]]
  # ③ Pipeline 全景
  [[ "$output" == *"Pipeline"* ]]
  [[ "$output" == *"Idea"* ]]
  [[ "$output" == *"Backlog"* ]]
  [[ "$output" == *"Build"* ]]
  # ④ Current Focus DoD — surfaces in-progress story id
  [[ "$output" == *"Current Focus"* ]]
  [[ "$output" == *"US-DEMO-002"* ]]
  # ⑤ Human × AI — no alerts/proposals/release → 自驱中
  [[ "$output" == *"AI 自驱中"* ]]
  # ⑥ Schedules + brief block
  [[ "$output" == *"Schedules"* ]]
}

@test "roll (no args): degrades gracefully when no BACKLOG.md" {
  rm BACKLOG.md
  run_roll
  [ "$status" -eq 0 ]
  # Without BACKLOG.md main() falls through to usage + changelog,
  # NOT the dashboard. Golden behaviour: still exits 0, prints usage.
  [[ "$output" == *"Usage:"* ]] || [[ "$output" == *"用法"* ]]
}
