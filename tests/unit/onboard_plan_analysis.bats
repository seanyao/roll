#!/usr/bin/env bats
# US-ONBOARD-016: lib/roll-plan-validate.py validation of the three Phase 2
# analysis sections (domain_model / tech_analysis / test_assessment).
#
# Focus:
#   - the sections are OPTIONAL (old plans without them still validate)
#   - when present they are structurally validated
#   - ANTI-HALLUCINATION HARD constraint: every test_assessment claim must be a
#     mapping carrying evidence: detected | inferred; untagged free-text is
#     rejected; a zero-result scan is the {claim: "none detected",
#     evidence: detected} path.
#
# The validator is invoked directly (python3 lib/roll-plan-validate.py <plan>),
# mirroring the slides_validate.bats pattern. Exit codes: 0 valid, 1 schema
# error, 2 stale, 3 bad version, 4 unreadable.

LIB="${BATS_TEST_DIRNAME}/../../lib"
VALIDATOR="${LIB}/roll-plan-validate.py"

setup() {
  TEST_TMP="$(mktemp -d)"
  # A fresh ISO 8601 timestamp keeps the freshness check (exit 2) from firing,
  # so non-zero results are attributable to schema (exit 1) only.
  NOW="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).isoformat())')"
}

teardown() {
  rm -rf "${TEST_TMP:-}"
}

# Write a plan.yaml: a valid core preamble + whatever extra sections the caller
# appends via stdin. Echoes the path.
write_plan() {
  local name="$1"; shift
  local extra="$1"; shift
  local path="${TEST_TMP}/${name}"
  {
    printf 'version: 1\n'
    printf 'generated_at: "%s"\n' "$NOW"
    printf 'project_understanding:\n  type: cli\n  description: "x"\n'
    printf 'scope:\n  approved: [backlog]\n'
    printf 'privacy:\n  gitignore_dot_roll: true\n'
    printf '%s' "$extra"
  } > "$path"
  echo "$path"
}

# ─── backward compatibility ───────────────────────────────────────────────────

@test "analysis sections are optional: a plan omitting all three still validates" {
  path=$(write_plan "old.yaml" "")
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 0 ]
}

@test "a full plan with all three well-formed sections validates" {
  path=$(write_plan "full.yaml" 'domain_model:
  bounded_contexts:
    - name: auth
      aggregates: [User, Session]
      ubiquitous_language: [login, token]
tech_analysis:
  stack: [bash, python3]
  dependencies: [pyyaml]
  architecture_notes: ["single-binary CLI"]
  risks:
    - description: "no macOS CI"
      severity: HIGH
      evidence: detected
test_assessment:
  current_layers:
    - claim: "112 bats files detected"
      evidence: detected
  gaps:
    - claim: "none detected"
      evidence: detected
  recommended_actions:
    - claim: "add macOS runner"
      evidence: inferred
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 0 ]
}

# ─── domain_model ─────────────────────────────────────────────────────────────

@test "domain_model: empty bounded_contexts is valid (none inferred, not invented)" {
  path=$(write_plan "dm-empty.yaml" 'domain_model:
  bounded_contexts: []
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 0 ]
}

@test "domain_model: missing bounded_contexts is rejected" {
  path=$(write_plan "dm-nobc.yaml" 'domain_model:
  notes: "oops"
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"domain_model.bounded_contexts missing"* ]]
}

@test "domain_model: a context without a name is rejected" {
  path=$(write_plan "dm-noname.yaml" 'domain_model:
  bounded_contexts:
    - aggregates: [User]
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"name missing"* ]]
}

@test "domain_model: aggregates must be a list" {
  path=$(write_plan "dm-badagg.yaml" 'domain_model:
  bounded_contexts:
    - name: auth
      aggregates: "User"
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"aggregates must be a list"* ]]
}

# ─── tech_analysis ────────────────────────────────────────────────────────────

@test "tech_analysis: stack must be a list" {
  path=$(write_plan "ta-badstack.yaml" 'tech_analysis:
  stack: "bash"
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"tech_analysis.stack must be a list"* ]]
}

@test "tech_analysis: a risk without a description is rejected" {
  path=$(write_plan "ta-norisk.yaml" 'tech_analysis:
  risks:
    - severity: HIGH
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"description missing"* ]]
}

@test "tech_analysis: a risk with a bad severity enum is rejected" {
  path=$(write_plan "ta-badsev.yaml" 'tech_analysis:
  risks:
    - description: "x"
      severity: CRITICAL
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"severity='CRITICAL' invalid"* ]]
}

@test "tech_analysis: a risk with a bad evidence tag is rejected" {
  path=$(write_plan "ta-badev.yaml" 'tech_analysis:
  risks:
    - description: "x"
      evidence: maybe
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"evidence='maybe' invalid"* ]]
}

@test "tech_analysis: risks with valid severity + evidence pass" {
  path=$(write_plan "ta-ok.yaml" 'tech_analysis:
  risks:
    - description: "x"
      severity: LOW
      evidence: inferred
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 0 ]
}

# ─── test_assessment: ANTI-HALLUCINATION HARD constraint ──────────────────────

@test "test_assessment: detected + inferred tagged claims pass" {
  path=$(write_plan "ts-tags.yaml" 'test_assessment:
  current_layers:
    - claim: "42 *.test.ts files detected"
      evidence: detected
  recommended_actions:
    - claim: "thin integration layer (no e2e config found)"
      evidence: inferred
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 0 ]
}

@test "test_assessment: untagged free-text claim (hallucinated filler) is REJECTED" {
  # The canonical filler the AC forbids. A bare string carries no evidence.
  path=$(write_plan "ts-filler.yaml" 'test_assessment:
  recommended_actions:
    - "needs more E2E tests"
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"must be a mapping carrying an 'evidence' tag"* ]]
}

@test "test_assessment: a claim mapping missing its evidence tag is REJECTED" {
  path=$(write_plan "ts-noev.yaml" 'test_assessment:
  gaps:
    - claim: "no coverage dir"
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"evidence missing"* ]]
}

@test "test_assessment: an invalid evidence value is REJECTED" {
  path=$(write_plan "ts-badev.yaml" 'test_assessment:
  current_layers:
    - claim: "x"
      evidence: probably
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"evidence='probably' invalid"* ]]
}

@test "test_assessment: the 'none detected' zero-result path is valid (evidence: detected)" {
  # A scan that ran and found nothing must say so explicitly, tagged detected.
  path=$(write_plan "ts-none.yaml" 'test_assessment:
  current_layers:
    - claim: "none detected"
      evidence: detected
  gaps:
    - claim: "none detected"
      evidence: detected
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 0 ]
}

@test "test_assessment: an empty recommended_actions bucket is valid (nothing missing)" {
  path=$(write_plan "ts-emptyrec.yaml" 'test_assessment:
  current_layers:
    - claim: "112 bats files detected"
      evidence: detected
  recommended_actions: []
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 0 ]
}

@test "test_assessment: a claim bucket that is not a list is rejected" {
  path=$(write_plan "ts-notlist.yaml" 'test_assessment:
  gaps: "no coverage"
')
  run python3 "$VALIDATOR" "$path"
  [ "$status" -eq 1 ]
  [[ "$output" == *"test_assessment.gaps must be a list"* ]]
}
