#!/usr/bin/env bats
# FIX-141: _loop_backfill_merged must not clobber caller's EXIT trap.
#
# Root cause: _loop_backfill_merged set `trap "rm -f '$tmp'" EXIT` and later
# `trap - EXIT`, wiping out any EXIT trap installed by its caller (e.g. the
# loop inner script's _inner_cleanup). When the cycle finished, _inner_cleanup
# never ran, so .pipe-*.raw files were left orphaned and no per-cycle .log
# was archived.

load helpers

setup()    { unit_setup; }
teardown() { unit_teardown; }

@test "_loop_backfill_merged: leaves caller's EXIT trap intact" {
  local marker="${TEST_TMP}/trap-fired"

  # Seed a runs.jsonl with one built entry so the function reaches the
  # trap - EXIT line in the old (buggy) implementation.
  cat > "${TEST_TMP}/runs.jsonl" <<'EOF'
{"ts":"2026-05-18T10:00:00Z","project":"x","run_id":"loop-1","status":"built","built":["FIX-141"],"cycle_id":"20260518-100000-1234"}
EOF

  # Run in a subshell so we can observe whether the EXIT trap fires.
  (
    # Install an EXIT trap that touches a marker file.
    trap 'touch "'"$marker"'"' EXIT

    # Mock dependencies so _loop_backfill_merged runs its full body.
    command() {
      if [ "$1" = "-v" ] && [ "$2" = "gh" ]; then return 0; fi
      if [ "$1" = "-v" ] && [ "$2" = "jq" ]; then return 0; fi
      builtin command "$@"
    }
    _gh_resolve() { eval "$1=test/repo"; return 0; }
    gh() {
      if [ "$1" = "-R" ]; then shift 2; fi
      if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
        # PR still open → backfill does nothing but DOES execute trap - EXIT
        echo '{"state":"OPEN","mergedAt":null,"mergeCommit":null}'
        return 0
      fi
      return 0
    }
    _loop_cleanup_stale_runs_tmp() { :; }

    _loop_backfill_merged "${TEST_TMP}/runs.jsonl"
  )

  # If the EXIT trap survived, the marker file must exist.
  [ -f "$marker" ]
}

@test "inner runner template: restores EXIT trap before normal completion" {
  local runner="${TEST_TMP}/run-trap-test.sh"
  _write_loop_runner_script "$runner" "${TEST_TMP}/fake-project" "echo ok" "${TEST_TMP}/log"
  local inner="${runner%.sh}-inner.sh"
  [ -f "$inner" ]

  # After _runs_append (the final step before natural exit) there must be a
  # defensive `trap '_inner_cleanup' EXIT` so that any earlier trap clobbering
  # is repaired before the shell exits.
  grep -qF "_runs_append" "$inner"
  grep -qF "trap '_inner_cleanup' EXIT" "$inner"
}
