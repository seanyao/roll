#!/usr/bin/env bash
# Roll i18n catalog — roll-fix skill user-facing strings (US-I18N-003).
# These are templates/output blocks shown to users by agents executing roll-fix.

# ── Section 3: Test Design Review ──
_i18n_set en fix.test_design "Test Design for Fix"
_i18n_set zh fix.test_design "修复测试设计"
_i18n_set en fix.verification_approach "Verification Approach"
_i18n_set zh fix.verification_approach "验证方式"
_i18n_set en fix.test_scenarios "Test Scenarios"
_i18n_set zh fix.test_scenarios "测试场景"
_i18n_set en fix.fix_verification "Fix verification"
_i18n_set zh fix.fix_verification "修复验证"
_i18n_set en fix.regression_check "Regression check"
_i18n_set zh fix.regression_check "回归检查"

# ── Section 4: TCR Implementation ──
_i18n_set en fix.tcr_cycle "TCR CYCLE FOR FIX"
_i18n_set zh fix.tcr_cycle "修复 TCR 循环"
_i18n_set en fix.micro_step "MICRO-STEP %s: %s"
_i18n_set zh fix.micro_step "微步骤 %s: %s"

# ── Section 6: Quality Review ──
_i18n_set en fix.self_review "Self Review Report"
_i18n_set zh fix.self_review "自审报告"
_i18n_set en fix.scope "Scope"
_i18n_set zh fix.scope "范围"
_i18n_set en fix.critical "Critical"
_i18n_set zh fix.critical "严重"
_i18n_set en fix.warnings "Warnings"
_i18n_set zh fix.warnings "警告"
_i18n_set en fix.suggestions "Suggestions"
_i18n_set zh fix.suggestions "建议"
_i18n_set en fix.passed_dimensions "Passed dimensions"
_i18n_set zh fix.passed_dimensions "通过维度"

# ── Section 10.5: Verification Gate ──
_i18n_set en fix.issue_resolved "Issue resolved"
_i18n_set zh fix.issue_resolved "问题已解决"

# ── Section 11: Report ──
_i18n_set en fix.bug_identified "Bug identified: %s"
_i18n_set zh fix.bug_identified "Bug 已识别: %s"
_i18n_set en fix.root_cause "Root cause"
_i18n_set zh fix.root_cause "根因"
_i18n_set en fix.fix_applied "Fix applied via TCR"
_i18n_set zh fix.fix_applied "已通过 TCR 应用修复"
_i18n_set en fix.tests_updated "Tests updated: %s"
_i18n_set zh fix.tests_updated "测试已更新: %s"
_i18n_set en fix.regression_verified "Regression verified"
_i18n_set zh fix.regression_verified "回归验证通过"
_i18n_set en fix.fix_complete "Fix complete: %s"
_i18n_set zh fix.fix_complete "修复完成: %s"
