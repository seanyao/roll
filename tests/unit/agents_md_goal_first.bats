#!/usr/bin/env bats
# Tests for US-CONV-001: Goal-Driven Execution rule in AGENTS.md

ROOT="${BATS_TEST_DIRNAME}/../.."

@test "conventions/global/AGENTS.md: Workflow has Goal First rule" {
  grep -qF 'Goal First' "${ROOT}/conventions/global/AGENTS.md"
}

@test "conventions/global/AGENTS.md: Goal First specifies verifiable success criteria" {
  grep -qE 'verifiable|success criteria' "${ROOT}/conventions/global/AGENTS.md"
}

@test "project AGENTS.md: Workflow has Goal First rule" {
  grep -qF 'Goal First' "${ROOT}/AGENTS.md"
}
