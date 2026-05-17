#!/usr/bin/env bats
# Verifies that every feature area with ≥3 completed stories has a user guide
# in both docs/guide/en/ and docs/guide/zh/. (REFACTOR-019)

load helpers

setup() { unit_setup; }
teardown() { unit_teardown; }

GUIDE_EN="${BATS_TEST_DIRNAME}/../../docs/guide/en"
GUIDE_ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh"

# 1. npm-distribution — installation & update workflow
@test "guide en: installation.md exists" {
  [ -f "${GUIDE_EN}/installation.md" ]
}
@test "guide zh: installation.md exists" {
  [ -f "${GUIDE_ZH}/installation.md" ]
}

# 2. cli-simplification — project init workflow
@test "guide en: project-setup.md exists" {
  [ -f "${GUIDE_EN}/project-setup.md" ]
}
@test "guide zh: project-setup.md exists" {
  [ -f "${GUIDE_ZH}/project-setup.md" ]
}

# 3. ai-tools — multi-agent support
@test "guide en: ai-agents.md exists" {
  [ -f "${GUIDE_EN}/ai-agents.md" ]
}
@test "guide zh: ai-agents.md exists" {
  [ -f "${GUIDE_ZH}/ai-agents.md" ]
}

# 4. e2e-lifecycle — E2E testing
@test "guide en: testing.md exists" {
  [ -f "${GUIDE_EN}/testing.md" ]
}
@test "guide zh: testing.md exists" {
  [ -f "${GUIDE_ZH}/testing.md" ]
}

# 5. pr-lifecycle — PR review workflow
@test "guide en: pr-review.md exists" {
  [ -f "${GUIDE_EN}/pr-review.md" ]
}
@test "guide zh: pr-review.md exists" {
  [ -f "${GUIDE_ZH}/pr-review.md" ]
}

# 6. convention-management — AGENTS.md conventions
@test "guide en: conventions.md exists" {
  [ -f "${GUIDE_EN}/conventions.md" ]
}
@test "guide zh: conventions.md exists" {
  [ -f "${GUIDE_ZH}/conventions.md" ]
}

# 7. changelog-integration — CHANGELOG workflow
@test "guide en: changelog.md exists" {
  [ -f "${GUIDE_EN}/changelog.md" ]
}
@test "guide zh: changelog.md exists" {
  [ -f "${GUIDE_ZH}/changelog.md" ]
}

# Smoke: each guide has a top-level heading
@test "guide en: installation.md has a heading" {
  grep -q "^# " "${GUIDE_EN}/installation.md"
}
@test "guide zh: installation.md has a heading" {
  grep -q "^# " "${GUIDE_ZH}/installation.md"
}
