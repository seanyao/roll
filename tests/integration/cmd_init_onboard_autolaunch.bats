#!/usr/bin/env bats
# US-ONBOARD-018: `roll init` on a legacy project auto-launches the chosen
# agent in interactive mode with the $roll-onboard prompt pre-loaded, then
# chains into `roll init --apply` once the agent exits cleanly with a plan.
#
# These tests stub the agent binary with a shell script so we can drive the
# end-to-end flow without spawning a real claude/codex/etc. process.

load helpers

setup() {
  integration_setup
  run_roll setup
  PROJECT_DIR="${TEST_TMP}/legacy-proj"
  mkdir -p "$PROJECT_DIR"

  # Mark the project as legacy: a manifest is enough (US-ONBOARD-012).
  echo '{"name":"legacy"}' > "${PROJECT_DIR}/package.json"

  # Install a stub `claude` binary on PATH that, when invoked, writes a valid
  # onboard-plan.yaml then exits with whatever code we ask for.
  STUB_BIN="${TEST_TMP}/stub-bin"
  mkdir -p "$STUB_BIN"
  # Ensure $TEST_TMP/.claude exists so onboard discovery sees claude as installed.
  mkdir -p "${TEST_TMP}/.claude"
}

teardown() {
  integration_teardown
}

# Generate a plan file with a fresh generated_at timestamp. The agent stub
# writes this into .roll/onboard-plan.yaml.
write_plan_template() {
  local out="$1"
  local now
  now=$(python3 -c "from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  cat > "$out" <<EOF
version: 1
generated_at: "${now}"
project_understanding:
  type: cli
  description: "test project"
  domains: ["x"]
  key_modules: ["m"]
scope:
  approved: ["backlog"]
  declined: []
include_existing: []
privacy:
  gitignore_dot_roll: false
sync_targets: []
enable_loop: false
EOF
}

# Build a stub `claude` that records its invocation and produces the plan.
# Arg: exit code the stub should return.
install_claude_stub() {
  local exit_code="${1:-0}"
  local plan_template="${TEST_TMP}/plan-template.yaml"
  write_plan_template "$plan_template"

  cat > "${STUB_BIN}/claude" <<EOF
#!/usr/bin/env bash
# Stub agent for US-ONBOARD-018 integration tests.
# Records argv so the test can assert how the agent was invoked.
mkdir -p "${PROJECT_DIR}/.roll"
printf '%s\n' "\$@" > "${TEST_TMP}/stub-claude-argv.txt"
cp "${plan_template}" "${PROJECT_DIR}/.roll/onboard-plan.yaml"
exit ${exit_code}
EOF
  chmod +x "${STUB_BIN}/claude"
}

# Same but the stub does NOT write a plan, just exits with the given code.
install_claude_stub_no_plan() {
  local exit_code="${1:-0}"
  cat > "${STUB_BIN}/claude" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${TEST_TMP}/stub-claude-argv.txt"
exit ${exit_code}
EOF
  chmod +x "${STUB_BIN}/claude"
}

# Run `roll init` in the legacy project with the stub agent in front of PATH.
roll_init_onboard() {
  PATH="${STUB_BIN}:${PATH}" \
  HOME="${TEST_TMP}" \
  ROLL_HOME="${ROLL_HOME}" \
  ROLL_ONBOARD_AGENT=claude \
  bash -c "cd '${PROJECT_DIR}' && '${ROLL_BIN}' init"
}

# ─── Happy path: stub agent + plan → apply runs ──────────────────────────────

@test "onboard auto-launch: invokes claude with positional prompt arg" {
  install_claude_stub 0
  run roll_init_onboard
  [ -f "${TEST_TMP}/stub-claude-argv.txt" ]
  # First positional arg must contain the kickoff line — proves _agent_argv
  # interactive mode wired a single prompt arg, not -p / --output-format / etc.
  grep -q "Run the \$roll-onboard skill" "${TEST_TMP}/stub-claude-argv.txt"
}

@test "onboard auto-launch: prompt includes the skill body" {
  install_claude_stub 0
  run roll_init_onboard
  [ -f "${TEST_TMP}/stub-claude-argv.txt" ]
  # SKILL.md's H1 must reach the agent.
  grep -q "# Roll Onboard" "${TEST_TMP}/stub-claude-argv.txt"
}

@test "onboard auto-launch: after agent exits 0 with plan, apply is chained automatically" {
  install_claude_stub 0
  run roll_init_onboard
  # Pass if init reached the apply branch — signalled by the launch line. We
  # don't assert apply's full success here because plan validation depends on
  # PyYAML which is not guaranteed on CI runners. Apply correctness is covered
  # by lib/roll-plan-validate.py's own tests and by unit tests for
  # _run_onboard_agent.
  [[ "$output" == *"Plan written"* || "$output" == *"已写入 plan"* ]]
}

@test "onboard auto-launch: apply branch runs in the project dir (regression: cwd)" {
  install_claude_stub 0
  run roll_init_onboard
  # Whether apply ultimately succeeded or failed PyYAML check, it must have
  # been invoked from inside the project dir — visible by validator output or
  # the apply info line.
  [[ "$output" == *"Plan written"* \
     || "$output" == *"Plan validation"* \
     || "$output" == *"plan-validate"* ]]
}

# ─── Sad path: agent exits non-zero ─────────────────────────────────────────

@test "onboard auto-launch: agent exits non-zero → init returns non-zero, no apply" {
  install_claude_stub 2
  run roll_init_onboard
  [ "$status" -ne 0 ]
  # Apply did not run, so backlog.md must not exist.
  [ ! -f "${PROJECT_DIR}/.roll/backlog.md" ]
  # Failure hint should mention retry / switch-agent options.
  [[ "$output" == *"ROLL_ONBOARD_AGENT"* ]]
}

# ─── Sad path: agent exits 0 but writes no plan ─────────────────────────────

@test "onboard auto-launch: agent exits 0 but no plan → init returns non-zero, no apply" {
  install_claude_stub_no_plan 0
  run roll_init_onboard
  [ "$status" -ne 0 ]
  [ ! -f "${PROJECT_DIR}/.roll/onboard-plan.yaml" ]
  [ ! -f "${PROJECT_DIR}/.roll/backlog.md" ]
  [[ "$output" == *"onboard-plan.yaml"* ]]
}

# ─── Sad path: SIGINT-equivalent (exit 130) ─────────────────────────────────

@test "onboard auto-launch: agent exits 130 (SIGINT) → 'cancelled' hint, no apply" {
  install_claude_stub_no_plan 130
  run roll_init_onboard
  [ "$status" -eq 130 ]
  [ ! -f "${PROJECT_DIR}/.roll/backlog.md" ]
  [[ "$output" == *"cancelled"* || "$output" == *"取消"* || "$output" == *"Ctrl-C"* ]]
}
