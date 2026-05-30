#!/usr/bin/env bats
# US-AGENT-029: user docs reflect the four-slot complexity routing model.
#
# These assert the doc-refresh AC: the autonomous guides + FAQ + agent guide
# describe the easy/default/hard/fallback complexity slots, the new `roll agent`
# commands, the mechanical fallback story, and that agents.yaml is per-machine
# (not committed). They also guard against the retired three-dimensional /
# soft-preference routing language sneaking back into the routing sections.

ROOT="${BATS_TEST_DIRNAME}/../.."
GUIDE_EN="${ROOT}/guide/en"
GUIDE_ZH="${ROOT}/guide/zh"

@test "EN ai-agents documents the four complexity slots" {
  grep -qF 'easy' "${GUIDE_EN}/ai-agents.md"
  grep -qF 'default' "${GUIDE_EN}/ai-agents.md"
  grep -qF 'hard' "${GUIDE_EN}/ai-agents.md"
  grep -qF 'fallback' "${GUIDE_EN}/ai-agents.md"
  grep -qF 'agents.yaml' "${GUIDE_EN}/ai-agents.md"
}

@test "ZH ai-agents documents the four complexity slots" {
  grep -qF 'easy' "${GUIDE_ZH}/ai-agents.md"
  grep -qF 'fallback' "${GUIDE_ZH}/ai-agents.md"
  grep -qF 'agents.yaml' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '复杂度' "${GUIDE_ZH}/ai-agents.md"
}

@test "EN ai-agents explains roll agent use locks the three tiers" {
  grep -qF 'roll agent use' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'lock.*(easy/default/hard|three.*tier)' "${GUIDE_EN}/ai-agents.md"
}

@test "ZH ai-agents explains roll agent use locks the three tiers" {
  grep -qF 'roll agent use' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '三档' "${GUIDE_ZH}/ai-agents.md"
}

@test "EN ai-agents states agents.yaml is per-machine / not committed" {
  grep -qiE 'per-machine|never committed|not committed|\.gitignore' "${GUIDE_EN}/ai-agents.md"
}

@test "ZH ai-agents states agents.yaml is per-machine / not committed" {
  grep -qiE 'per-machine|不进 git|绝不.*commit|gitignore' "${GUIDE_ZH}/ai-agents.md"
}

@test "EN loop documents the complexity classifier thresholds" {
  grep -qF 'est_min <= 8' "${GUIDE_EN}/loop.md"
  grep -qF 'est_min > 20' "${GUIDE_EN}/loop.md"
}

@test "ZH loop documents the complexity classifier thresholds" {
  grep -qF 'est_min <= 8' "${GUIDE_ZH}/loop.md"
  grep -qF 'est_min > 20' "${GUIDE_ZH}/loop.md"
}

@test "EN loop documents mechanical fallback to the fallback slot" {
  grep -qiE 'fallback' "${GUIDE_EN}/loop.md"
  grep -qF 'fallback_from' "${GUIDE_EN}/loop.md"
}

@test "ZH loop documents mechanical fallback to the fallback slot" {
  grep -qF 'fallback_from' "${GUIDE_ZH}/loop.md"
}

@test "EN faq fallback section names the fallback slot agent" {
  grep -qF 'fallback' "${GUIDE_EN}/faq.md"
  grep -qF 'runs.jsonl' "${GUIDE_EN}/faq.md"
}

@test "ZH faq fallback section names the fallback slot agent" {
  grep -qF 'fallback' "${GUIDE_ZH}/faq.md"
}

# Guard: the retired three-dimensional routing config must not be presented as
# the active mechanism in the loop routing sections. agent-routes.yaml as the
# routing config file is gone from the guides.
@test "EN loop.md no longer references agent-routes.yaml as the routing config" {
  ! grep -qF 'agent-routes.yaml' "${GUIDE_EN}/loop.md"
}

@test "ZH loop.md no longer references agent-routes.yaml as the routing config" {
  ! grep -qF 'agent-routes.yaml' "${GUIDE_ZH}/loop.md"
}

@test "README indexes the ai-agents guide page (both languages)" {
  grep -qF 'guide/en/ai-agents.md' "${ROOT}/README.md"
  grep -qF 'guide/zh/ai-agents.md' "${ROOT}/README.md"
  grep -qF 'guide/en/ai-agents.md' "${ROOT}/README_CN.md"
  grep -qF 'guide/zh/ai-agents.md' "${ROOT}/README_CN.md"
}
