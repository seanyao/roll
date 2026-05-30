#!/usr/bin/env bats
# Integration test for US-LOOP-040: the .command exit summary is wired into
# the loop runner so the Terminal window renders a per-cycle summary block
# before `press enter to close`.
#
# The macOS `.command` file is generated at cycle runtime by the outer runner
# (run-<slug>.sh) and only physically written when the popup branch fires
# (skipped under bats). The deterministic artifact is the generated runner
# itself, whose embedded `.command` heredoc must carry the summary invocation
# and the `Cycle ... Summary` title that the renderer emits.

load helpers

setup() {
  require_not_in_real_loop
  integration_setup
  run_roll setup
}

teardown() { integration_teardown; }

@test "loop runner embeds the exit-summary call before press-enter (US-LOOP-040)" {
  [[ "$(uname)" != "Darwin" ]] && skip "macOS-only .command popup path"

  run_roll loop on
  [ "$status" -eq 0 ]

  # Pick the outer runner (run-<slug>.sh, not the -inner.sh).
  local runner=""
  for f in "${TEST_TMP}/.shared/roll/loop/run-"*.sh; do
    [[ -f "$f" && "$f" != *-inner.sh ]] && runner="$f" && break
  done
  [ -n "$runner" ]

  # The .command heredoc must invoke the summary renderer subcommand …
  grep -qF '_loop_render_exit_summary' "$runner"
  # … and it must come before the `press enter to close` prompt so the user
  # sees the summary first.
  local sum_line enter_line
  sum_line=$(grep -n '_loop_render_exit_summary' "$runner" | head -1 | cut -d: -f1)
  enter_line=$(grep -n 'press enter to close' "$runner" | head -1 | cut -d: -f1)
  [ -n "$sum_line" ]
  [ -n "$enter_line" ]
  [ "$sum_line" -le "$enter_line" ]
}

@test "renderer produces a 'Cycle <id> Summary' title line from a runs row" {
  # End-to-end of the renderer itself: feed a runs.jsonl row and assert the
  # title line the .command window will print.
  local rt="${TEST_TMP}/.roll/loop"
  mkdir -p "$rt"
  printf '%s\n' '{"status":"done","cycle_id":"20260530-1","built":["US-LOOP-040"],"tcr_count":2,"phases":{"agent_invoke":99}}' > "${rt}/runs.jsonl"

  run env ROLL_PROJECT_RUNTIME_DIR="$rt" bash "$ROLL_BIN" _loop_render_exit_summary "any-slug" "20260530-1"
  [ "$status" -eq 0 ]
  [[ "$output" =~ Cycle.*Summary ]]
  [[ "$output" == *"built: US-LOOP-040"* ]]
}
