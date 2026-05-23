#!/usr/bin/env bash
# Roll i18n catalog — doctor command (US-I18N-002).

_i18n_set en doctor.stale_plists "Stale launchd plists"
_i18n_set zh doctor.stale_plists "无效的 launchd 服务"
_i18n_set en doctor.stale_plists_cleanup "Path is stale, clean up with"
_i18n_set zh doctor.stale_plists_cleanup "路径已失效，可清理"

_i18n_set en doctor.pr_review_extras "PR review extras"
_i18n_set zh doctor.pr_review_extras "PR 评审两档开关"

_i18n_set en doctor.pr_double_gate_enabled "✅ AI review double gate enabled"
_i18n_set zh doctor.pr_double_gate_enabled "✅ AI 评审双门已启用"
_i18n_set en doctor.pr_double_gate_disabled "⚪ AI review double gate not enabled"
_i18n_set zh doctor.pr_double_gate_disabled "⚪ 双门未启用"
_i18n_set en doctor.pr_double_gate_unknown "⚪ AI review double gate state unknown — requires gh auth"
_i18n_set zh doctor.pr_double_gate_unknown "⚪ 状态未知（需要 gh auth）"

_i18n_set en doctor.pr_event_enabled "✅ Event-driven PR review installed"
_i18n_set zh doctor.pr_event_enabled "✅ 事件驱动 PR 评审已安装"
_i18n_set en doctor.pr_event_disabled "⚪ Event-driven PR review not installed"
_i18n_set zh doctor.pr_event_disabled "⚪ 事件驱动 PR 评审未安装"

_i18n_set en doctor.pr_event_optional "Optional — enable event-driven PR review (seconds-fast, GitHub only)."
_i18n_set zh doctor.pr_event_optional "可选 —— 启用事件驱动 PR 评审（秒级响应，仅限 GitHub）。"
_i18n_set en doctor.pr_event_without "Without this, Roll reviews PRs each loop cycle (~1h). With it,"
_i18n_set zh doctor.pr_event_without "不安装也行 — loop 每轮会兜底评审。安装后"
_i18n_set en doctor.pr_event_without_zh "contributors get AI feedback on PR open/update immediately."
_i18n_set zh doctor.pr_event_without_zh "PR 一开即触发 AI 评审。"
_i18n_set en doctor.pr_event_secret "Then set the API key secret for your configured agent in GitHub repo settings."
_i18n_set zh doctor.pr_event_secret "然后在 GitHub 仓库设置中添加你配置的 agent 对应的 API key secret。"
