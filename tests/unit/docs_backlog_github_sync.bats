#!/usr/bin/env bats
# US-SYNC-007: doc-update closing story for the github-issues-sync feature.
# Asserts the bilingual user guide for `roll backlog sync` exists and covers
# the required sections: auth, command examples, .roll/local.yaml fields,
# label→type mapping table, and idempotent behaviour. Also checks the README
# documentation table links to it and the help text mentions sync.

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

GUIDE_EN="${BATS_TEST_DIRNAME}/../../guide/en/backlog-github-sync.md"
GUIDE_ZH="${BATS_TEST_DIRNAME}/../../guide/zh/backlog-github-sync.md"
README="${BATS_TEST_DIRNAME}/../../README.md"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

@test "guide en: backlog-github-sync.md exists with a heading" {
  [ -f "$GUIDE_EN" ]
  grep -q "^# " "$GUIDE_EN"
}

@test "guide zh: backlog-github-sync.md exists with a heading" {
  [ -f "$GUIDE_ZH" ]
  grep -q "^# " "$GUIDE_ZH"
}

@test "guide en: documents GITHUB_TOKEN and gh auth" {
  grep -q "GITHUB_TOKEN" "$GUIDE_EN"
  grep -q "gh auth" "$GUIDE_EN"
}

@test "guide en: documents the sync command flags" {
  grep -q -- "--repo" "$GUIDE_EN"
  grep -q -- "--dry-run" "$GUIDE_EN"
  grep -q -- "--label" "$GUIDE_EN"
}

@test "guide en: documents the label to type mapping" {
  grep -qi "bug" "$GUIDE_EN"
  grep -q "FIX" "$GUIDE_EN"
  grep -q "REFACTOR" "$GUIDE_EN"
}

@test "guide en: documents .roll/local.yaml backlog_sync block" {
  grep -q "backlog_sync" "$GUIDE_EN"
  grep -q "last_sync_at" "$GUIDE_EN"
}

@test "guide en: documents idempotent (already exists) behaviour" {
  grep -qi "idempotent\|already exists\|GH-" "$GUIDE_EN"
}

@test "guide zh: documents GITHUB_TOKEN auth and backlog_sync config" {
  grep -q "GITHUB_TOKEN" "$GUIDE_ZH"
  grep -q "backlog_sync" "$GUIDE_ZH"
}

@test "README links to the backlog-github-sync guide in both languages" {
  grep -q "guide/en/backlog-github-sync.md" "$README"
  grep -q "guide/zh/backlog-github-sync.md" "$README"
}

@test "roll backlog help mentions the sync subcommand" {
  grep -q "sync" "$ROLL_BIN"
  # The backlog command listing in README advertises sync as a subcommand.
  grep -q "sync" "$README"
}
