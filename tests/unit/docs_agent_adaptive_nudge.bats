#!/usr/bin/env bats
# US-AGENT-031: user docs explain the transparent in-tier adaptive soft nudge
# (US-AGENT-030). These assert the doc-refresh AC: the agent guide describes how
# the soft priority is computed (in-tier, per agent × story type, sample floor,
# deterministic), where to read the nudge reason (runs.jsonl / event log), how to
# turn it off (ROLL_AGENT_NUDGE=0, then == pure est_min routing), and how it
# differs from the retired (unpredictable) history preference: deterministic,
# auditable, one-switch off. README already indexes the ai-agents guide page.

ROOT="${BATS_TEST_DIRNAME}/../.."
GUIDE_EN="${ROOT}/guide/en"
GUIDE_ZH="${ROOT}/guide/zh"

@test "EN ai-agents documents the in-tier soft nudge algorithm" {
  grep -qiE 'soft priority|in-tier nudge|adaptive soft' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'hit-rate|hit_rate' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'story type' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'sample floor|fewer than 8|n=8|< 8' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'deterministic' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'in-tier only|never changed|never moved' "${GUIDE_EN}/ai-agents.md"
}

@test "ZH ai-agents documents the in-tier soft nudge algorithm" {
  grep -qF '软优先' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '档内' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '命中率' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '故事类型' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '样本下限' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '确定性' "${GUIDE_ZH}/ai-agents.md"
}

@test "EN ai-agents says where to read the nudge reason (runs.jsonl / event log)" {
  grep -qF 'runs.jsonl' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'event log|story_routed' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'rationale|reason' "${GUIDE_EN}/ai-agents.md"
}

@test "ZH ai-agents says where to read the nudge reason (runs.jsonl / event log)" {
  grep -qF 'runs.jsonl' "${GUIDE_ZH}/ai-agents.md"
  grep -qiE '事件日志|story_routed' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '理由' "${GUIDE_ZH}/ai-agents.md"
}

@test "EN ai-agents documents the off switch == pure est_min routing" {
  grep -qF 'ROLL_AGENT_NUDGE=0' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'est_min' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'exactly|unchanged|no reordering' "${GUIDE_EN}/ai-agents.md"
}

@test "ZH ai-agents documents the off switch == pure est_min routing" {
  grep -qF 'ROLL_AGENT_NUDGE=0' "${GUIDE_ZH}/ai-agents.md"
  grep -qF 'est_min' "${GUIDE_ZH}/ai-agents.md"
  grep -qiE '完全.*等同|不做任何重排' "${GUIDE_ZH}/ai-agents.md"
}

@test "EN ai-agents distinguishes the new nudge from the retired soft preference" {
  grep -qiE 'retired' "${GUIDE_EN}/ai-agents.md"
  grep -qiE 'deterministic, auditable' "${GUIDE_EN}/ai-agents.md"
}

@test "ZH ai-agents distinguishes the new nudge from the retired soft preference" {
  grep -qiE '弃用|被弃用' "${GUIDE_ZH}/ai-agents.md"
  grep -qF '确定、可审计、可一键关' "${GUIDE_ZH}/ai-agents.md"
}
