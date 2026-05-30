#!/usr/bin/env bash
# Roll i18n catalog — `roll skills` command (US-SKILL-016).
# Generated skills catalog: scan skills/*/SKILL.md frontmatter → guide/skills.md.

_i18n_set en skills.generated "Generated skill catalog: %s"
_i18n_set zh skills.generated "已生成技能清单：%s"

_i18n_set en skills.check_ok "Skill catalog is up to date."
_i18n_set zh skills.check_ok "技能清单已是最新。"

_i18n_set en skills.check_drift "Skill catalog drift: %s differs from a fresh scan. Run 'roll skills generate'."
_i18n_set zh skills.check_drift "技能清单漂移：%s 与最新扫描不一致。请运行 'roll skills generate'。"

_i18n_set en skills.check_missing "Skill catalog not found at %s. Run 'roll skills generate'."
_i18n_set zh skills.check_missing "未找到技能清单 %s。请运行 'roll skills generate'。"

_i18n_set en skills.unknown_sub "Unknown 'roll skills' subcommand: %s"
_i18n_set zh skills.unknown_sub "未知的 'roll skills' 子命令：%s"

_i18n_set en skills.usage "Usage: roll skills <generate|check>"
_i18n_set zh skills.usage "用法：roll skills <generate|check>"

_i18n_set en skills.doctor_heading "Skill catalog"
_i18n_set zh skills.doctor_heading "技能清单"

_i18n_set en skills.doctor_ok "✅ guide/skills.md matches skills/*/SKILL.md"
_i18n_set zh skills.doctor_ok "✅ guide/skills.md 与 skills/*/SKILL.md 一致"

_i18n_set en skills.doctor_drift "⚠️  guide/skills.md is stale — run 'roll skills generate'"
_i18n_set zh skills.doctor_drift "⚠️  guide/skills.md 已过期 — 请运行 'roll skills generate'"
