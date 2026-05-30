#!/usr/bin/env bats
# US-SKILL-016: guide/skills.md is a generated catalog projected from
# skills/*/SKILL.md frontmatter (single source of truth). These tests pin:
#   1. frontmatter projection (name + description, incl. YAML block scalars),
#   2. a newly added skill auto-appears in the catalog,
#   3. drift guard (check) fails on a stale catalog and passes when in sync,
#   4. the committed guide/skills.md matches a fresh scan of the real skills/.
# bats tier: fast

load helpers

setup() {
  unit_setup
}
teardown() { unit_teardown; }

# Build a throwaway fixture skills/ tree with two skills: one quoted-scalar
# description, one YAML block-scalar (`|`) description.
_make_fixture() {
  FIX="${TEST_TMP}/skills"
  mkdir -p "${FIX}/alpha" "${FIX}/beta"
  cat > "${FIX}/alpha/SKILL.md" <<'MD'
---
name: alpha
license: MIT
description: "Alpha does the first thing."
---
# Alpha
MD
  cat > "${FIX}/beta/SKILL.md" <<'MD'
---
name: beta
allowed-tools: "Read, Write"
description: |
  Beta does the second thing across
  multiple lines that should fold.
---
# Beta
MD
}

@test "US-SKILL-016: generate projects name + description from frontmatter" {
  _make_fixture
  run _skills_catalog_generate "$FIX"
  [ "$status" -eq 0 ]
  [[ "$output" == *'| `alpha` | Alpha does the first thing. |'* ]]
}

@test "US-SKILL-016: folds YAML block-scalar descriptions onto one line" {
  _make_fixture
  run _skills_catalog_generate "$FIX"
  [ "$status" -eq 0 ]
  [[ "$output" == *'| `beta` | Beta does the second thing across multiple lines that should fold. |'* ]]
}

@test "US-SKILL-016: block scalar with no closing --- still yields its text (EOF guard)" {
  FIX="${TEST_TMP}/skills"
  mkdir -p "${FIX}/omega"
  # Intentionally malformed: frontmatter block scalar runs to EOF with no
  # closing --- line. The parser must still emit the collected description.
  printf -- '---\nname: omega\ndescription: |\n  Omega keeps going\n  to the very end' > "${FIX}/omega/SKILL.md"
  run _skill_frontmatter_field "${FIX}/omega/SKILL.md" description
  [ "$status" -eq 0 ]
  [ "$output" = "Omega keeps going to the very end" ]
}

@test "US-SKILL-016: a newly added skill auto-appears in the catalog" {
  _make_fixture
  run _skills_catalog_generate "$FIX"
  ! [[ "$output" == *'`gamma`'* ]]

  mkdir -p "${FIX}/gamma"
  cat > "${FIX}/gamma/SKILL.md" <<'MD'
---
name: gamma
description: Gamma is brand new.
---
# Gamma
MD
  run _skills_catalog_generate "$FIX"
  [ "$status" -eq 0 ]
  [[ "$output" == *'| `gamma` | Gamma is brand new. |'* ]]
}

@test "US-SKILL-016: skills check passes when catalog matches a fresh scan" {
  _make_fixture
  local target="${TEST_TMP}/skills.md"
  # Point both the catalog path and the scan source at the fixture so check is
  # fully isolated from the real repo. cmd_skills is a sourced function, so we
  # set ROLL_PKG_DIR in the current shell (env(1) would fork a process that
  # can't see the function).
  eval "_skills_catalog_path() { printf '%s' '${target}'; }"
  ROLL_PKG_DIR="$TEST_TMP"
  _skills_catalog_generate "$FIX" > "$target"
  run cmd_skills check
  [ "$status" -eq 0 ]
}

@test "US-SKILL-016: skills check fails (drift) when catalog is hand-edited" {
  _make_fixture
  local target="${TEST_TMP}/skills.md"
  eval "_skills_catalog_path() { printf '%s' '${target}'; }"
  ROLL_PKG_DIR="$TEST_TMP"
  _skills_catalog_generate "$FIX" > "$target"
  printf '\n| `manual-drift` | sneaked in by hand |\n' >> "$target"
  run cmd_skills check
  [ "$status" -ne 0 ]
}

@test "US-SKILL-016: committed guide/skills.md is in sync with skills/*/SKILL.md" {
  # The real CI drift guard: regenerate from the actual repo and diff against
  # the committed product. Fails if someone adds/edits a skill but forgets to
  # run 'roll skills generate'.
  local repo="${BATS_TEST_DIRNAME}/../.."
  run diff -u "${repo}/guide/skills.md" <(_skills_catalog_generate "${repo}/skills")
  [ "$status" -eq 0 ]
}
