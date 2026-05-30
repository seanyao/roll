#!/usr/bin/env bats
# US-LOOP-027: user docs explain that non-Claude agent token/cost capture is
# per-agent — pi/OpenAI/Gemini/Kimi/Qwen are covered, OpenCode still shows
# `—/—`, and a new agent does not appear automatically (it ships as a plugin).
#
# These assert the doc-refresh AC across both languages (EN/ZH separate lines):
# FAQ A5 and the loop guide Token-column section carry the coverage matrix, and
# the CHANGELOG records the entry for the next version.

ROOT="${BATS_TEST_DIRNAME}/../.."
FAQ_EN="${ROOT}/guide/en/faq.md"
FAQ_ZH="${ROOT}/guide/zh/faq.md"
LOOP_EN="${ROOT}/guide/en/loop.md"
LOOP_ZH="${ROOT}/guide/zh/loop.md"
CHANGELOG="${ROOT}/CHANGELOG.md"

@test "EN FAQ states pi/OpenAI/Gemini/Kimi/Qwen token/cost are captured" {
  grep -qiF 'pi (DeepSeek)' "${FAQ_EN}"
  grep -qiF 'Gemini' "${FAQ_EN}"
  grep -qiF 'Kimi' "${FAQ_EN}"
  grep -qiF 'Qwen' "${FAQ_EN}"
}

@test "EN FAQ states OpenCode still shows the dash placeholder" {
  grep -qiF 'OpenCode' "${FAQ_EN}"
  grep -qF '—/—' "${FAQ_EN}"
}

@test "EN FAQ states new agent support is not automatic (per-agent plugin)" {
  grep -qiE 'does not appear automatically|not automatic' "${FAQ_EN}"
  grep -qF 'lib/agent_usage/README.md' "${FAQ_EN}"
}

@test "ZH FAQ states pi/Gemini/Kimi/Qwen token/cost are captured" {
  grep -qiF 'pi（DeepSeek）' "${FAQ_ZH}"
  grep -qiF 'Gemini' "${FAQ_ZH}"
  grep -qiF 'Kimi' "${FAQ_ZH}"
  grep -qiF 'Qwen' "${FAQ_ZH}"
}

@test "ZH FAQ states OpenCode still shows the dash placeholder and is not automatic" {
  grep -qiF 'OpenCode' "${FAQ_ZH}"
  grep -qF '—/—' "${FAQ_ZH}"
  grep -qF '不会自动出现' "${FAQ_ZH}"
  grep -qF 'lib/agent_usage/README.md' "${FAQ_ZH}"
}

@test "EN loop guide carries the per-agent coverage matrix" {
  grep -qiF 'OpenCode' "${LOOP_EN}"
  grep -qF '—/—' "${LOOP_EN}"
  grep -qF 'lib/agent_usage/' "${LOOP_EN}"
}

@test "ZH loop guide carries the per-agent coverage matrix" {
  grep -qiF 'OpenCode' "${LOOP_ZH}"
  grep -qF '—/—' "${LOOP_ZH}"
  grep -qF 'lib/agent_usage/' "${LOOP_ZH}"
}

@test "CHANGELOG records the non-Claude token/cost entry" {
  grep -qF '非 Claude agent 也能看到 token/成本' "${CHANGELOG}"
}
