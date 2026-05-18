#!/usr/bin/env bats
# Tests for US-CONV-002: "Where to Look" section in AGENTS.md + roll-design updates

ROOT="${BATS_TEST_DIRNAME}/../.."
DESIGN_SKILL="${ROOT}/skills/roll-design/SKILL.md"

@test "conventions/global/AGENTS.md: has Where to Look section" {
  grep -qF 'Where to Look' "${ROOT}/conventions/global/AGENTS.md"
}

@test "conventions/global/AGENTS.md: Where to Look points to .roll/domain/" {
  grep -qF '.roll/domain/' "${ROOT}/conventions/global/AGENTS.md"
}

@test "conventions/templates/cli/AGENTS.md: has Where to Look section" {
  grep -qF 'Where to Look' "${ROOT}/conventions/templates/cli/AGENTS.md"
}

@test "conventions/templates/fullstack/AGENTS.md: has Where to Look section" {
  grep -qF 'Where to Look' "${ROOT}/conventions/templates/fullstack/AGENTS.md"
}

@test "conventions/templates/frontend-only/AGENTS.md: has Where to Look section" {
  grep -qF 'Where to Look' "${ROOT}/conventions/templates/frontend-only/AGENTS.md"
}

@test "conventions/templates/backend-service/AGENTS.md: has Where to Look section" {
  grep -qF 'Where to Look' "${ROOT}/conventions/templates/backend-service/AGENTS.md"
}

@test "roll-design SKILL.md: Clarify phase has product-end/role/domain three-step" {
  grep -qE '产品端|product end' "${DESIGN_SKILL}"
}

@test "roll-design SKILL.md: Domain Slice step updates AGENTS.md Where to Look pointer" {
  grep -qE 'Where to Look' "${DESIGN_SKILL}"
}
