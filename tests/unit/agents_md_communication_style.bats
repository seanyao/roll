#!/usr/bin/env bats
# Tests for FIX-055: consistent plain-language Voice rule in AGENTS.md

ROOT="${BATS_TEST_DIRNAME}/../.."

@test "conventions/global/AGENTS.md: Communication has Voice rule" {
  grep -qF 'Voice' "${ROOT}/conventions/global/AGENTS.md"
}

@test "conventions/global/AGENTS.md: Voice rule specifies plain or natural language" {
  grep -qE 'plain|natural|colleague' "${ROOT}/conventions/global/AGENTS.md"
}

@test "conventions/global/AGENTS.md: Voice rule gives anti-pattern example" {
  grep -qE 'robotic|Executing|Task completed' "${ROOT}/conventions/global/AGENTS.md"
}

@test "AGENTS.md: Communication has Voice rule" {
  grep -qF 'Voice' "${ROOT}/AGENTS.md"
}

@test "conventions/global/AGENTS.md: existing Bilingual rule still present" {
  grep -qF 'Bilingual' "${ROOT}/conventions/global/AGENTS.md"
}
