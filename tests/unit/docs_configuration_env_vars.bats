#!/usr/bin/env bats
# Verifies that user-overridable environment variables referenced in bin/roll
# are documented in docs/guide/{en,zh}/configuration.md (REFACTOR-029).

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

DOCS_EN="${BATS_TEST_DIRNAME}/../../docs/guide/en/configuration.md"
DOCS_ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh/configuration.md"

@test "configuration.md (en) documents ROLL_LOOP_FORCE" {
  grep -q "ROLL_LOOP_FORCE" "${DOCS_EN}"
}
@test "configuration.md (en) documents ROLL_LOOP_NO_HEAL" {
  grep -q "ROLL_LOOP_NO_HEAL" "${DOCS_EN}"
}
@test "configuration.md (en) documents ROLL_LOOP_HEAL_MAX" {
  grep -q "ROLL_LOOP_HEAL_MAX" "${DOCS_EN}"
}
@test "configuration.md (en) documents ROLL_PR_MERGE_TIMEOUT" {
  grep -q "ROLL_PR_MERGE_TIMEOUT" "${DOCS_EN}"
}
@test "configuration.md (en) documents ROLL_LOOP_NO_POPUP" {
  grep -q "ROLL_LOOP_NO_POPUP" "${DOCS_EN}"
}

@test "configuration.md (zh) documents ROLL_LOOP_FORCE" {
  grep -q "ROLL_LOOP_FORCE" "${DOCS_ZH}"
}
@test "configuration.md (zh) documents ROLL_LOOP_NO_HEAL" {
  grep -q "ROLL_LOOP_NO_HEAL" "${DOCS_ZH}"
}
@test "configuration.md (zh) documents ROLL_LOOP_HEAL_MAX" {
  grep -q "ROLL_LOOP_HEAL_MAX" "${DOCS_ZH}"
}
@test "configuration.md (zh) documents ROLL_PR_MERGE_TIMEOUT" {
  grep -q "ROLL_PR_MERGE_TIMEOUT" "${DOCS_ZH}"
}
@test "configuration.md (zh) documents ROLL_LOOP_NO_POPUP" {
  grep -q "ROLL_LOOP_NO_POPUP" "${DOCS_ZH}"
}
