#!/usr/bin/env bash
# v3 TS test entry — runs the workspace vitest suites and writes the same
# proof-of-pass record hooks/pre-commit verifies (owner ruling 2026-06-05:
# the TCR gate accepts vitest proof alongside bats; bats retires after the
# porting completes). New file on the v3 branch — frozen v2 bash untouched.
set -euo pipefail

# Hermetic gate: tests must behave identically on a TTY, headless, and in CI.
# Any git credential prompt is a bug — fail it loudly instead of blocking.
export GIT_TERMINAL_PROMPT=0

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# FIX-325 — affected scope for the TCR commit gate.
# `roll test` (the per-commit gate) passes `--affected`; `npm test` (CI /
# pre-push, no flag) stays the FULL suite. Before this, `--affected` was a no-op
# and `roll test` ran the full suite — which in a cycle's worktree hits
# env-divergent failures (attest/run-cycle/npm-pack: red locally, green in CI)
# that NO change introduced. The proof could then never be written, so every
# cycle's TCR commit was blocked → the agent's green work was discarded as
# gave_up. Affected scope runs only the dependency closure of the change
# (`vitest --changed`), so a focused delivery commits on its own green tests;
# CI keeps the full suite as the real cross-package gate. (Implements FIX-135's
# original intent, which stubbed the affected path.)
SCOPE="full"
for _arg in "$@"; do
  if [ "$_arg" = "--affected" ]; then SCOPE="affected"; fi
done

pnpm -r build
node scripts/audit-role-taxonomy.mjs
if [ "$SCOPE" = "affected" ]; then
  # `--changed` (no ref) = tests covering the working-tree / uncommitted change
  # — exactly a cycle's pre-commit scope. Packages already pass --passWithNoTests,
  # so a change that touches no covered test is honestly green (0 affected).
  #
  # Affected scope alone is NOT enough: the heavy E2E/integration suites
  # (run-cycle.integration, critical-flows.e2e, npm-pack) are transitively
  # depended on by broad code, so most changes "affect" them — and they are
  # env-divergent (red locally / in a cycle worktree, GREEN in CI). Including
  # them would re-block the commit gate. Exclude them from the LOCAL affected
  # gate; CI's full `npm test` (no --affected) runs them as the real gate.
  # Making them env-portable is FIX-316; until then they gate at CI, not commit.
  # `pnpm -r test -- <flags>` injects a `--` that makes vitest treat the flags as
  # positional file filters; drive vitest directly via `exec` so --changed/--exclude
  # parse as flags. `--filter ./packages/*` runs each workspace package's vitest.
  pnpm --filter "./packages/*" exec vitest run --passWithNoTests --changed \
    --exclude '**/*.integration.test.ts' \
    --exclude '**/*.e2e.test.ts' \
    --exclude '**/npm-pack.test.ts'
else
  pnpm -r test
fi

_TREE="$(git -C "$REPO_ROOT" write-tree 2>/dev/null || true)"
if [ -n "$_TREE" ]; then
  mkdir -p "$REPO_ROOT/.roll"
  printf '{"ts":%s,"tree":"%s","mode":"vitest","scope":"%s"}\n' "$(date +%s)" "$_TREE" "$SCOPE" \
    > "$REPO_ROOT/.roll/last-test-pass"
fi
# FIX-1264 — vitest-based obsolete snapshot guard: any .snap file without a
# corresponding test file is a landmine that silently drifts. Fail loud.
_SNAP_DIR="$REPO_ROOT/packages/cli/test/__snapshots__"
_TEST_DIR="$REPO_ROOT/packages/cli/test"
_ORPHANS=""
if [ -d "$_SNAP_DIR" ]; then
  for _snap in "$_SNAP_DIR"/*.snap; do
    [ -f "$_snap" ] || continue
    _base="$(basename "$_snap" .snap)"
    if [ ! -f "$_TEST_DIR/$_base" ]; then
      _ORPHANS="$_ORPHANS  $(basename "$_snap")\n"
    fi
  done
fi
if [ -n "$_ORPHANS" ]; then
  printf "❌ Orphan vitest snapshot files (no corresponding test):\n%b" "$_ORPHANS"
  printf "   Run vitest --update to remove them, or restore the test file.\n"
  exit 1
fi
echo "✓ TS suites green (scope: $SCOPE) — test-pass proof written (mode: vitest)"
