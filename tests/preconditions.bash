#!/usr/bin/env bash
# Standardised precondition helpers for the test suite. (US-QA-004)
#
# Each helper inspects runtime environment and either:
#   - returns 0 silently when its condition is met, or
#   - calls bats `skip "<reason>"` so the current test is reported as skipped
#     (not failed) and CI does not gate on it.
#
# Defaults are opt-in: a test that does not call any `require_*` runs as before.
# Add `require_*` calls to setup() or the test body only when the test would be
# unsafe or meaningless in the current environment.

# Skip the test when running inside a real `roll loop` cycle.
#
# The cycle wrapper (run-roll-<slug>.sh / -inner.sh) exports CYCLE_ID for every
# command it spawns. Any test that touches the host's real launchd state via
# `run_roll loop on/off` or `run_roll setup` would mutate (or even disable) the
# very service running the cycle — see FIX-074.
require_not_in_real_loop() {
  [[ -z "${CYCLE_ID:-}" ]] && return 0
  skip "inside real loop cycle (CYCLE_ID=${CYCLE_ID}); would mutate host launchd state"
}
