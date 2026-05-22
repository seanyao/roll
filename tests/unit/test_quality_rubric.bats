#!/usr/bin/env bats
# Tests for US-QA-006 test-quality rubric + roll-.dream Scan 7 integration.
# Verifies the rubric is published in both EN/ZH and that the dream skill knows
# how to emit structured `[test-quality:❶..❻]` REFACTOR entries.

REPO="${BATS_TEST_DIRNAME}/../.."
RUBRIC_EN="${REPO}/docs/testing/quality-rubric.md"
RUBRIC_ZH="${REPO}/docs/testing/quality-rubric.zh.md"
SKILL="${REPO}/skills/roll-.dream/SKILL.md"
DRY_RUN="${REPO}/bin/dream-test-quality-scan"

# --- Rubric file existence -------------------------------------------------

@test "quality-rubric.md exists at docs/testing/" {
  [ -f "$RUBRIC_EN" ]
}

@test "quality-rubric.zh.md exists at docs/testing/" {
  [ -f "$RUBRIC_ZH" ]
}

# --- Six anti-pattern categories present in both languages -----------------

@test "EN rubric covers all six anti-pattern markers ❶..❻" {
  for marker in ❶ ❷ ❸ ❹ ❺ ❻; do
    grep -qF "$marker" "$RUBRIC_EN" || { echo "missing: $marker"; return 1; }
  done
}

@test "ZH rubric covers all six anti-pattern markers ❶..❻" {
  for marker in ❶ ❷ ❸ ❹ ❺ ❻; do
    grep -qF "$marker" "$RUBRIC_ZH" || { echo "missing: $marker"; return 1; }
  done
}

# --- Each category in EN rubric has the four required parts ----------------

@test "EN rubric: each category includes Definition / Signals / Fix template / Real example" {
  grep -qE '^### Definition' "$RUBRIC_EN"
  grep -qE '^### Signals'    "$RUBRIC_EN"
  grep -qE '^### Fix template' "$RUBRIC_EN"
  grep -qE '^### Real example' "$RUBRIC_EN"
}

@test "ZH rubric: each category includes the four required Chinese subsections" {
  grep -qF '定义' "$RUBRIC_ZH"
  grep -qF '判定信号' "$RUBRIC_ZH"
  grep -qF '最小修复模板' "$RUBRIC_ZH"
  grep -qF '真实代码反例' "$RUBRIC_ZH"
}

# --- Dream SKILL.md integration --------------------------------------------

@test "roll-.dream SKILL.md: adds Scan 7 — Test Quality" {
  grep -qE '^### Scan 7' "$SKILL"
  grep -qE 'Test Quality' "$SKILL"
}

@test "roll-.dream SKILL.md: emits [test-quality:❶|❷|...] REFACTOR tag" {
  grep -qF '[test-quality:' "$SKILL"
}

@test "roll-.dream SKILL.md: rate cap — each cycle ≤ 5 test-quality entries" {
  grep -qE '≤ ?5' "$SKILL"
  grep -qF '每轮' "$SKILL"
}

@test "roll-.dream SKILL.md: references docs/testing/quality-rubric.md" {
  grep -qF 'docs/testing/quality-rubric.md' "$SKILL"
}

# --- Dry-run helper finds a real ❶ instance in current suite ---------------

@test "dream-test-quality-scan helper exists and is executable" {
  [ -x "$DRY_RUN" ]
}

@test "dry-run helper finds ❶ hardcoded-data instance (model_prices.bats)" {
  run "$DRY_RUN" --category 1 --path "${REPO}/tests/unit/model_prices.bats"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[test-quality:❶]"* ]]
  [[ "$output" == *"model_prices.bats"* ]]
}

@test "dry-run helper respects --max default of 5 entries per run" {
  # Help text must document the cap so the dream scan stays bounded.
  run "$DRY_RUN" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--max"* ]]
  [[ "$output" == *"5"* ]]
}
