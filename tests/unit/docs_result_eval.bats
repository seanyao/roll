#!/usr/bin/env bats
# US-EVAL-005: user docs explain cycle result-eval, `roll loop eval`, and the
# self-evolution signals — in both languages, EN/ZH on separate lines.
#
# These assert the doc-refresh AC: the loop guides document the six-dimension
# result-eval rubric, the `roll loop eval` trend view, and `roll loop signals`;
# the README index links the section; and — critically — the docs keep the
# objective result-eval distinct from the subjective skill self-score (the AC's
# "no doc conflates result-eval with skill-self-score" check).

ROOT="${BATS_TEST_DIRNAME}/../.."
GUIDE_EN="${ROOT}/guide/en/loop.md"
GUIDE_ZH="${ROOT}/guide/zh/loop.md"

@test "EN loop documents the six result-eval rubric dimensions" {
  grep -qF 'outcome' "${GUIDE_EN}"
  grep -qF 'correctness' "${GUIDE_EN}"
  grep -qF 'scope_fidelity' "${GUIDE_EN}"
  grep -qF 'quality' "${GUIDE_EN}"
  grep -qF 'efficiency' "${GUIDE_EN}"
  grep -qF 'cleanliness' "${GUIDE_EN}"
}

@test "ZH loop documents the six result-eval rubric dimensions" {
  grep -qF 'outcome' "${GUIDE_ZH}"
  grep -qF 'scope_fidelity' "${GUIDE_ZH}"
  grep -qF 'cleanliness' "${GUIDE_ZH}"
  grep -qF 'rubric' "${GUIDE_ZH}"
}

@test "EN loop documents roll loop eval and its output" {
  grep -qF 'roll loop eval' "${GUIDE_EN}"
  grep -qF 'result_eval' "${GUIDE_EN}"
  # The verified summary line wording must be present (pasted real output).
  grep -qF 'result-eval: mean' "${GUIDE_EN}"
  grep -qF '(n/a) need 3' "${GUIDE_EN}"
}

@test "ZH loop documents roll loop eval and its output" {
  grep -qF 'roll loop eval' "${GUIDE_ZH}"
  grep -qF 'result_eval' "${GUIDE_ZH}"
  grep -qF '(n/a) need 3' "${GUIDE_ZH}"
}

@test "EN loop documents roll loop signals as advisory, never auto-activating" {
  grep -qF 'roll loop signals' "${GUIDE_EN}"
  grep -qF 'candidates.md' "${GUIDE_EN}"
  grep -qiE 'never (edits|activates|changes)|advisory only' "${GUIDE_EN}"
}

@test "ZH loop documents roll loop signals as advisory, never auto-activating" {
  grep -qF 'roll loop signals' "${GUIDE_ZH}"
  grep -qF 'candidates.md' "${GUIDE_ZH}"
  grep -qF '待人确认' "${GUIDE_ZH}"
}

# AC: no doc conflates objective result-eval with subjective skill self-scoring.
# Both guides must explicitly draw the distinction.
@test "EN loop distinguishes result-eval from skill self-scoring" {
  grep -qiE 'NOT skill self-scoring|not skill self-score' "${GUIDE_EN}"
}

@test "ZH loop distinguishes result-eval from skill self-scoring" {
  grep -qF '不是 skill 自评' "${GUIDE_ZH}"
}

@test "README indexes the cycle result-eval section (both READMEs)" {
  grep -qF 'guide/en/loop.md#cycle-result-eval' "${ROOT}/README.md"
  grep -qF 'guide/en/loop.md#cycle-result-eval' "${ROOT}/README_CN.md"
}
