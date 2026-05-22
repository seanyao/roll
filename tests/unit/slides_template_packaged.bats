#!/usr/bin/env bats
# FIX-088: built-in slide templates must ship in the npm tarball.
# Regression guard against the original bug where templates lived under
# site/slides/templates/ but the package.json files whitelist did not
# include site/, so every npm install lacked the templates and
# `roll slides build` blew up with "Template not found".

load helpers

setup() {
  unit_setup
  REPO_ROOT="${BATS_TEST_DIRNAME}/../.."
}

teardown() { unit_teardown; }

@test "FIX-088: introduction-v3 template lives under lib/slides/templates/" {
  [ -f "${REPO_ROOT}/lib/slides/templates/introduction-v3.html" ]
}

@test "FIX-088: npm pack --dry-run includes lib/slides/templates/introduction-v3.html" {
  command -v npm >/dev/null 2>&1 || skip "npm not installed"
  run npm pack --dry-run --json --prefix "$REPO_ROOT"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q 'lib/slides/templates/introduction-v3.html'
}
