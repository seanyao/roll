#!/usr/bin/env bats
# Tests for US-CONV-003: roll-doc generates AGENTS.md Where to Look section

ROOT="${BATS_TEST_DIRNAME}/../.."
DOC_SKILL="${ROOT}/skills/roll-doc/SKILL.md"

@test "roll-doc SKILL.md: Phase 3 Fill includes AGENTS.md as a gap target" {
  grep -qE 'AGENTS\.md' "${DOC_SKILL}"
}

@test "roll-doc SKILL.md: generates Where to Look section in AGENTS.md" {
  grep -qE 'Where to Look' "${DOC_SKILL}"
}

@test "roll-doc SKILL.md: only writes pointers to directories that actually exist" {
  grep -qE 'actually exist|実際に存在|only.*exist' "${DOC_SKILL}"
}

@test "roll-doc SKILL.md: AGENTS.md bootstrap is idempotent (no duplicate pointers)" {
  grep -qE 'idempotent|idempoten|重复写入|already present' "${DOC_SKILL}"
}
