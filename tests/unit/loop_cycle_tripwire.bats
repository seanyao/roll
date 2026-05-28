#!/usr/bin/env bats
# FIX-125: cycle-context tripwire — refuse host-loop mutations from inside a cycle.
#
# Two known canonical-LaunchAgents bypass paths in bin/roll:
#   - _loop_gc orphan-remove (Phase 1 of GC)
#   - cmd_offboard plist-rm loop
# Both deliberately scan/mutate ${HOME}/Library/LaunchAgents directly. From inside
# a loop cycle (ROLL_LOOP_AGENT / ROLL_CYCLE_LOG_RAW exported by cycle runner),
# they must refuse rather than touch host launchd state.

load helpers

setup() {
  unit_setup_cd
  # Stub the same interactive helpers offboard_command.bats stubs so we don't
  # paint escapes into the bats output buffer.
  err()  { echo "ERR: $*" >&2; }
  warn() { echo "WARN: $*" >&2; }
  ok()   { echo "OK: $*"; }
  info() { echo "INFO: $*"; }
  unset ROLL_LOOP_AGENT ROLL_CYCLE_LOG_RAW
}

teardown() {
  unset ROLL_LOOP_AGENT ROLL_CYCLE_LOG_RAW
  unit_teardown_cd
}

# ── _loop_in_cycle predicate ──────────────────────────────────────────────

@test "_loop_in_cycle: true when ROLL_LOOP_AGENT is set" {
  export ROLL_LOOP_AGENT=pi
  run _loop_in_cycle
  [ "$status" -eq 0 ]
}

@test "_loop_in_cycle: true when ROLL_CYCLE_LOG_RAW is set" {
  export ROLL_CYCLE_LOG_RAW=/tmp/cycle.log
  run _loop_in_cycle
  [ "$status" -eq 0 ]
}

@test "_loop_in_cycle: false when neither env is set" {
  unset ROLL_LOOP_AGENT ROLL_CYCLE_LOG_RAW
  run _loop_in_cycle
  [ "$status" -ne 0 ]
}

@test "_loop_in_cycle: false when both envs are empty strings" {
  export ROLL_LOOP_AGENT=""
  export ROLL_CYCLE_LOG_RAW=""
  run _loop_in_cycle
  [ "$status" -ne 0 ]
}

# ── tripwire: _loop_gc refuses inside a cycle ─────────────────────────────

@test "_loop_gc: refuses with non-zero exit when ROLL_LOOP_AGENT is set" {
  export ROLL_LOOP_AGENT=pi
  # Sandbox HOME so the test can't accidentally touch real LaunchAgents.
  local fake_home="${BATS_TEST_TMPDIR}/home"
  mkdir -p "${fake_home}/Library/LaunchAgents"
  : > "${fake_home}/Library/LaunchAgents/com.roll.loop.canary.plist"
  HOME="$fake_home" run _loop_gc --dry-run
  [ "$status" -ne 0 ]
  # Canary plist must still exist — the tripwire returned before touching it.
  [ -f "${fake_home}/Library/LaunchAgents/com.roll.loop.canary.plist" ]
  # Refusal message identifies the guard so operators can grep it.
  [[ "$output" == *"cycle-context"* ]] || [[ "$output" == *"refus"* ]]
}

@test "_loop_gc: refuses with non-zero exit when ROLL_CYCLE_LOG_RAW is set" {
  export ROLL_CYCLE_LOG_RAW=/tmp/cycle.log
  local fake_home="${BATS_TEST_TMPDIR}/home"
  mkdir -p "${fake_home}/Library/LaunchAgents"
  HOME="$fake_home" run _loop_gc --dry-run
  [ "$status" -ne 0 ]
}

# ── tripwire: cmd_offboard plist-rm refuses inside a cycle ────────────────

@test "cmd_offboard --confirm: refuses to unload plists when in cycle context" {
  # Seed a changeset that would, without the tripwire, cause cmd_offboard to
  # unload + rm a canary plist under ~/Library/LaunchAgents.
  local fake_home="${BATS_TEST_TMPDIR}/home"
  mkdir -p "${fake_home}/Library/LaunchAgents"
  : > "${fake_home}/Library/LaunchAgents/com.roll.loop.canary.plist"

  mkdir -p .roll
  cat > .roll/onboard-changeset.yaml <<EOF
onboarded_at: "2026-05-28T00:00:00Z"
files_created: []
dirs_created: []
gitignore_entries_added: []
launchd_plists_installed:
  - com.roll.loop.canary.plist
EOF

  export ROLL_LOOP_AGENT=pi
  HOME="$fake_home" run cmd_offboard --confirm
  [ "$status" -ne 0 ]
  # Canary plist still present — tripwire fired before plist-rm phase.
  [ -f "${fake_home}/Library/LaunchAgents/com.roll.loop.canary.plist" ]
}
