#!/usr/bin/env bats
# Tests for REFACTOR-029: document the four less-known config variables
# in user-facing docs so users and contributors can discover them.

EN="${BATS_TEST_DIRNAME}/../../docs/guide/en/configuration.md"
ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh/configuration.md"

@test "EN configuration.md documents ROLL_TEMPLATES" {
  grep -qF 'ROLL_TEMPLATES' "$EN"
}

@test "EN configuration.md documents ROLL_PKG_CONVENTIONS" {
  grep -qF 'ROLL_PKG_CONVENTIONS' "$EN"
}

@test "EN configuration.md documents ROLL_LOOP_FORCE" {
  grep -qF 'ROLL_LOOP_FORCE' "$EN"
}

@test "EN configuration.md documents _ROLL_MERGE_SUMMARY" {
  grep -qF '_ROLL_MERGE_SUMMARY' "$EN"
}

@test "ZH configuration.md documents ROLL_TEMPLATES" {
  grep -qF 'ROLL_TEMPLATES' "$ZH"
}

@test "ZH configuration.md documents ROLL_PKG_CONVENTIONS" {
  grep -qF 'ROLL_PKG_CONVENTIONS' "$ZH"
}

@test "ZH configuration.md documents ROLL_LOOP_FORCE" {
  grep -qF 'ROLL_LOOP_FORCE' "$ZH"
}

@test "ZH configuration.md documents _ROLL_MERGE_SUMMARY" {
  grep -qF '_ROLL_MERGE_SUMMARY' "$ZH"
}
