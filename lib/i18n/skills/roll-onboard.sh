#!/usr/bin/env bash
# Roll i18n catalog — roll-onboard skill user-facing strings (US-I18N-003).
# These are the templates/questions shown to users by agents executing roll-onboard.

# ── Step 0-2: Setup ──
_i18n_set en onboard.welcome "Welcome to Roll Onboard"
_i18n_set zh onboard.welcome "欢迎使用 Roll Onboard"
_i18n_set en onboard.scanning "Scanning project..."
_i18n_set zh onboard.scanning "正在扫描项目..."
_i18n_set en onboard.stop_migrate_first "This project has legacy Roll structure (BACKLOG.md or docs/features/). Run 'npx @seanyao/roll@2 migrate' first before onboarding."
_i18n_set zh onboard.stop_migrate_first "此项目还保留着旧版 Roll 结构（BACKLOG.md 或 docs/features/）。请先运行 'npx @seanyao/roll@2 migrate' 再 onboard。"

# ── Step 3: Nine Questions ──
_i18n_set en onboard.questions_group1 "Group 1/3: Understanding your project"
_i18n_set zh onboard.questions_group1 "第 1/3 组: 理解你的项目"
_i18n_set en onboard.questions_group2 "Group 2/3: Defining scope"
_i18n_set zh onboard.questions_group2 "第 2/3 组: 定义范围"
_i18n_set en onboard.questions_group3 "Group 3/3: Privacy & preferences"
_i18n_set zh onboard.questions_group3 "第 3/3 组: 隐私与偏好"
_i18n_set en onboard.q1 "I see this is a %s project doing %s — correct?"
_i18n_set zh onboard.q1 "我看到这是一个 %s 项目，做的是 %s — 对吗？"
_i18n_set en onboard.q2 "The main business domains look like %s — anything to add or correct?"
_i18n_set zh onboard.q2 "主要业务领域看起来有 %s — 有需要补充或纠正的吗？"
_i18n_set en onboard.q3 "The key modules are %s — any missed or mis-identified?"
_i18n_set zh onboard.q3 "关键模块是 %s — 有遗漏或识别错误的吗？"
_i18n_set en onboard.q4 "Which artifacts should I generate?"
_i18n_set zh onboard.q4 "需要生成哪些产出物？"

# ── Step 4: Plan complete ──
_i18n_set en onboard.plan_written "Onboard plan written to .roll/onboard-plan.yaml"
_i18n_set zh onboard.plan_written "Onboard 计划已写入 .roll/onboard-plan.yaml"
_i18n_set en onboard.next_step "Next: run 'roll init --apply' to execute this plan"
_i18n_set zh onboard.next_step "下一步: 运行 'roll init --apply' 执行此计划"
