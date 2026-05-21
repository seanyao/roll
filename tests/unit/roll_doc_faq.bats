#!/usr/bin/env bats

GUIDE_EN="${BATS_TEST_DIRNAME}/../../guide/en"
GUIDE_ZH="${BATS_TEST_DIRNAME}/../../guide/zh"

@test "faq.md exists in EN guide" {
  [ -f "${GUIDE_EN}/faq.md" ]
}

@test "faq.md exists in ZH guide" {
  [ -f "${GUIDE_ZH}/faq.md" ]
}

@test "EN faq covers safety guardrails for newcomers" {
  grep -qiE "TCR|guardrail|never.*main|test && commit" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers legacy project onboarding" {
  grep -qiE "legacy|existing project|onboard" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers manual mode (no autonomous loop)" {
  grep -qiE "manual|opt.in|one story at a time|roll build " "${GUIDE_EN}/faq.md"
}

@test "EN faq covers uninstall path" {
  grep -qiE "uninstall" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers cost / token visibility" {
  grep -qiE "cost|token|pricing" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers comparison with related projects" {
  grep -qiE "superpowers|oh-my-codex|claude code" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers loop stuck / In Progress" {
  grep -qiE "stuck|in.progress|not moving" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers PR merge conflict / rebase failure" {
  grep -qiE "merge conflict|rebase.*(fail|error)" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers multi-project loop interference" {
  grep -qiE "multiple project|multi.*project|interfere|per.project" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers observability (logs / runs / brief)" {
  grep -qF "roll loop runs" "${GUIDE_EN}/faq.md"
  grep -qiE "roll loop monitor|roll loop attach|brief" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers when human intervention is needed vs auto-recovery" {
  grep -qiE "human.*interven|manual|auto.*recov" "${GUIDE_EN}/faq.md"
}

@test "EN faq provides mental model / rationale for each item" {
  local count
  count=$(grep -ciE "why this happens|under the hood|how it works|rationale|mental model|principle" "${GUIDE_EN}/faq.md" || true)
  [ "$count" -ge 5 ]
}

@test "ZH faq structure mirrors EN faq" {
  local en_h2 zh_h2
  en_h2=$(grep -c '^## ' "${GUIDE_EN}/faq.md")
  zh_h2=$(grep -c '^## ' "${GUIDE_ZH}/faq.md")
  [ "$en_h2" -eq "$zh_h2" ]
}

@test "README.md docs index references faq" {
  grep -qF 'faq.md' "${BATS_TEST_DIRNAME}/../../README.md"
}

@test "README_CN.md docs index references faq" {
  grep -qF 'faq.md' "${BATS_TEST_DIRNAME}/../../README_CN.md"
}
