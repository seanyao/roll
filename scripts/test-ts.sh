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

pnpm -r build
pnpm -r test

_TREE="$(git -C "$REPO_ROOT" write-tree 2>/dev/null || true)"
if [ -n "$_TREE" ]; then
  mkdir -p "$REPO_ROOT/.roll"
  printf '{"ts":%s,"tree":"%s","mode":"vitest"}\n' "$(date +%s)" "$_TREE" \
    > "$REPO_ROOT/.roll/last-test-pass"
fi
echo "✓ TS suites green — test-pass proof written (mode: vitest)"
