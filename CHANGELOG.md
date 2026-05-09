# Changelog

## 2026.05.10
- **Added**: E2E test auto-deposit during Story delivery (roll-build Phase 5.5)
- **Added**: E2E gating step in template CI — runs on every push, skips gracefully if no E2E exists
- **Added**: CI failure triage guidance — severity classification and actionable backlog routing
- **Added**: roll-debug auto-fix — diagnoses and auto-repairs when root cause is in project source
- **Added**: Changelog auto-generation after every deploy, with historical backfill on first run

## 2026.05.06
- **Added**: OpenCode integration — detect opencode, sync global AGENTS.md

## 2026.05.05
- **Fixed**: Sync prunes stale files to prevent ghost files on user machines
- **Fixed**: Corrected outdated references in AGENTS.md
- **Fixed**: Corrected Stack section in GEMINI.md

## 2026.05.04
- **Added**: BB Injection mode for roll-debug — mount diagnostic probe on pages without native integration

## 2026.04.24
- **Added**: Trae IDE support — project_rules.md convention files and bin/roll integration

## 2026.04.20
- **Added**: roll-release skill — one-command publish flow

## 2026.04.19
- **Added**: npm distribution — ROLL_PKG_DIR separation, `roll update` command, background version check, npm publish infrastructure

## 2026.04.17
- **Added**: roll-jot — fast backlog capture for bugs and ideas
- **Added**: roll-.clarify — passive scope clarification for vague build requests

## 2026.04.16
- **Improved**: CLI simplified — three-step minimal init, conventions repositioned as skill references, Project Context Rule added
