#!/usr/bin/env bats
# E2E golden path for US-DOC-006: doc coverage pipeline integrity

DREAM_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-.dream/SKILL.md"
BRIEF_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-brief/SKILL.md"

@test "e2e: roll-.dream has all 5 scan sections" {
  grep -qF 'Scan 1' "${DREAM_SKILL}"
  grep -qF 'Scan 2' "${DREAM_SKILL}"
  grep -qF 'Scan 3' "${DREAM_SKILL}"
  grep -qF 'Scan 4' "${DREAM_SKILL}"
  grep -qF 'Scan 5' "${DREAM_SKILL}"
}

@test "e2e: roll-.dream scan 5 describes all three checks (A, B, C)" {
  grep -qiE "Check A" "${DREAM_SKILL}"
  grep -qiE "Check B" "${DREAM_SKILL}"
  grep -qiE "Check C" "${DREAM_SKILL}"
}

@test "e2e: roll-.dream dream log template includes 文档覆盖度 section" {
  grep -qF '文档覆盖度' "${DREAM_SKILL}"
}

@test "e2e: roll-brief template outputs 文档覆盖度 block in briefs" {
  grep -qF '文档覆盖度' "${BRIEF_SKILL}"
  grep -qF 'guide/en' "${BRIEF_SKILL}"
  grep -qF 'ZH 翻译率' "${BRIEF_SKILL}"
}
