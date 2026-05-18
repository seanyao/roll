#!/usr/bin/env bats

GUIDE_EN="${BATS_TEST_DIRNAME}/../../guide/en"
GUIDE_ZH="${BATS_TEST_DIRNAME}/../../guide/zh"

@test "faq.md exists in EN guide" {
  [ -f "${GUIDE_EN}/faq.md" ]
}

@test "faq.md exists in ZH guide" {
  [ -f "${GUIDE_ZH}/faq.md" ]
}

@test "EN faq covers loop stuck / In Progress" {
  grep -qiE "stuck|in.progress|not moving" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers BACKLOG not updated after loop" {
  grep -qiE "backlog.*(not|didn).*(update|change)|not.*(mark|updat).*done" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers agent review rejecting own PR" {
  grep -qiE "CHANGES_REQUESTED|reject.*own|review.*own PR" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers PR merge conflict / rebase failure" {
  grep -qiE "merge conflict|rebase.*(fail|error)" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers switching agents" {
  grep -qiE "roll agent use|switch.*agent|primary_agent" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers multi-project loop interference" {
  grep -qiE "multiple project|multi.*project|interfere|per.project" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers gh auth / PR permissions" {
  grep -qiE "gh auth|authentication|PR.*permission|write.*access" "${GUIDE_EN}/faq.md"
}

@test "EN faq covers pausing loop" {
  grep -qF "roll loop pause" "${GUIDE_EN}/faq.md"
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
