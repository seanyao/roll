#!/usr/bin/env bats
# FIX-083: cmd_loop's status case must forward "$@" so flags like --days N
# reach _loop_status (which passes them to lib/roll-loop-status.py). Before
# this fix, `roll loop status --days 7` silently used default 3 days.

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"
ROLL_STATUS_PY="${BATS_TEST_DIRNAME}/../../lib/roll-loop-status.py"

@test "cmd_loop status case forwards \"\$@\" to _loop_status" {
  grep -E 'status\)[[:space:]]+_loop_status[[:space:]]+"\$@"' "$ROLL_BIN"
}

@test "roll loop status --days N renders N*24h in title" {
  # Direct python invocation proves the renderer honours --days; this test
  # locks in that the shell dispatcher actually forwards the flag so the
  # python script sees it.
  run env HOME="$(mktemp -d)" NO_COLOR=1 bash "$ROLL_BIN" loop status --days 7
  [ "$status" -eq 0 ]
  [[ "$output" == *"168h"* ]]
}

@test "dashboard 'more' hint uses the form that actually works" {
  # The hint must include 'status' — `roll loop --days 7` fails because
  # cmd_loop treats --days as an unknown subcommand.
  grep -E 'roll loop status --days' "$ROLL_STATUS_PY"
}
