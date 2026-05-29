#!/usr/bin/env bats
# US-AGENT-022: complexity classifier (est_min → easy/default/hard).
#
# Supersedes the three-dimensional (type/est/risk) hard-rule matcher. Routing
# now turns on a single axis: a story's est_min maps to a complexity tier.
#   est_min <= 8      → easy
#   8 < est_min <= 20 → default
#   est_min > 20      → hard
#   missing / illegal → default

LIB="${BATS_TEST_DIRNAME}/../../lib/loop_pick_agent.py"

setup() {
  TEST_TMP=$(mktemp -d)
  cd "$TEST_TMP"
  mkdir -p .roll/features/test-epic
  cat > .roll/backlog.md <<'MD'
# Project Backlog

| [US-EASY-008](.roll/features/test-epic/t.md#us-easy-008) | boundary 8 | 📋 Todo |
| [US-DEF-009](.roll/features/test-epic/t.md#us-def-009)   | boundary 9 | 📋 Todo |
| [US-DEF-020](.roll/features/test-epic/t.md#us-def-020)   | boundary 20 | 📋 Todo |
| [US-HARD-021](.roll/features/test-epic/t.md#us-hard-021) | boundary 21 | 📋 Todo |
| [US-NOEST-001](.roll/features/test-epic/t.md#us-noest-001) | no estimate | 📋 Todo |
MD
  cat > .roll/features/test-epic/t.md <<'MD'
# Feature: test

<a id="us-easy-008"></a>
## US-EASY-008 boundary 8
**Agent profile:**
- est_min: 8
- risk_zone: high
- chain_depth: 0

<a id="us-def-009"></a>
## US-DEF-009 boundary 9
**Agent profile:**
- est_min: 9
- risk_zone: low
- chain_depth: 0

<a id="us-def-020"></a>
## US-DEF-020 boundary 20
**Agent profile:**
- est_min: 20
- risk_zone: low
- chain_depth: 0

<a id="us-hard-021"></a>
## US-HARD-021 boundary 21
**Agent profile:**
- est_min: 21
- risk_zone: low
- chain_depth: 0

<a id="us-noest-001"></a>
## US-NOEST-001 no estimate
This story has no Agent profile block.
MD
}

teardown() {
  cd /
  rm -rf "$TEST_TMP"
}

classify() { python3 "$LIB" --story-id "$1" --backlog .roll/backlog.md; }

@test "classify: est_min=8 → easy (upper edge of easy)" {
  run classify US-EASY-008
  [ "$status" -eq 0 ]
  [[ "$output" == easy\ * ]]
}

@test "classify: est_min=9 → default (just above easy)" {
  run classify US-DEF-009
  [ "$status" -eq 0 ]
  [[ "$output" == default\ * ]]
}

@test "classify: est_min=20 → default (upper edge of default)" {
  run classify US-DEF-020
  [ "$status" -eq 0 ]
  [[ "$output" == default\ * ]]
}

@test "classify: est_min=21 → hard (just above default)" {
  run classify US-HARD-021
  [ "$status" -eq 0 ]
  [[ "$output" == hard\ * ]]
}

@test "classify: missing est_min → default" {
  run classify US-NOEST-001
  [ "$status" -eq 0 ]
  [[ "$output" == default\ * ]]
}

@test "classify: --est-min direct, illegal value → default" {
  run python3 "$LIB" --est-min notanumber
  [ "$status" -eq 0 ]
  [[ "$output" == default\ * ]]
}

@test "classify: --est-min direct, empty value → default" {
  run python3 "$LIB" --est-min ""
  [ "$status" -eq 0 ]
  [[ "$output" == default\ * ]]
}

@test "classify: --est-min=1 → easy (well inside easy)" {
  run python3 "$LIB" --est-min 1
  [ "$status" -eq 0 ]
  [[ "$output" == easy\ * ]]
}

@test "classify: --est-min=100 → hard (well inside hard)" {
  run python3 "$LIB" --est-min 100
  [ "$status" -eq 0 ]
  [[ "$output" == hard\ * ]]
}

@test "classify: --est-min negative → default (invalid data, not easy)" {
  run python3 "$LIB" --est-min -1
  [ "$status" -eq 0 ]
  [[ "$output" == default\ * ]]
}

@test "classify: unknown story id → non-zero exit" {
  run classify US-DOES-NOT-EXIST
  [ "$status" -ne 0 ]
}
