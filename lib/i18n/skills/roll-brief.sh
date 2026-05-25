#!/usr/bin/env bash
# Roll i18n catalog — roll-brief skill user-facing strings (US-I18N-003).
# These are the templates shown to users by agents executing roll-brief.

# ── Brief content headers ──
_i18n_set en brief.title "Roll Brief — %s"
_i18n_set zh brief.title "Roll 简报 — %s"
_i18n_set en brief.summary "Summary"
_i18n_set zh brief.summary "摘要"
_i18n_set en brief.completed "Completed: %s"
_i18n_set zh brief.completed "已完成: %s"
_i18n_set en brief.in_progress "In Progress: %s"
_i18n_set zh brief.in_progress "进行中: %s"
_i18n_set en brief.backlog_queue "Backlog Queue: %s pending"
_i18n_set zh brief.backlog_queue "Backlog 队列: %s 个待办"
_i18n_set en brief.requires_attention "Requires Attention"
_i18n_set zh brief.requires_attention "需要关注"
_i18n_set en brief.release_readiness "Release Readiness"
_i18n_set zh brief.release_readiness "发版就绪"
_i18n_set en brief.ready "Ready to release"
_i18n_set zh brief.ready "可以发版"
_i18n_set en brief.not_ready "Not ready — %s blockers"
_i18n_set zh brief.not_ready "暂不可发版 — %s 个阻塞项"

# ── Section headers in generated brief ──
_i18n_set en brief.section_completed "Completed (%s items)"
_i18n_set zh brief.section_completed "已完成（%s 项）"
_i18n_set en brief.section_in_progress "In Progress"
_i18n_set zh brief.section_in_progress "进行中"
_i18n_set en brief.section_queue "Pending Queue (%s items)"
_i18n_set zh brief.section_queue "待处理队列（%s 项）"
_i18n_set en brief.section_insights "Insights from Dream"
_i18n_set zh brief.section_insights "悟见"
_i18n_set en brief.section_escalations "Requires Human Attention"
_i18n_set zh brief.section_escalations "需人工介入"
_i18n_set en brief.section_doc_coverage "Documentation Coverage"
_i18n_set zh brief.section_doc_coverage "文档覆盖度"
_i18n_set en brief.section_release "Release Readiness"
_i18n_set zh brief.section_release "发版就绪"

# ── Step 5: Notification ──
_i18n_set en brief.generated "Brief generated: %s"
_i18n_set zh brief.generated "简报已生成：%s"
_i18n_set en brief.release_ready_status "Ready to release"
_i18n_set zh brief.release_ready_status "可发版"
_i18n_set en brief.release_hold_status "Hold — %s"
_i18n_set zh brief.release_hold_status "暂缓 — %s"
