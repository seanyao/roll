#!/usr/bin/env bats
# Integration (E2E) tests for: roll brief v2 redesign (US-VIEW-006)
# Golden path: user sees SUMMARY / HIGHLIGHTS / DECIDE sections.

load helpers

setup() {
  integration_setup
  export NO_COLOR=1
  export TERM=dumb
}

teardown() {
  integration_teardown
}

_make_project_brief() {
  mkdir -p "${TEST_TMP}/.roll/briefs"
  cat > "${TEST_TMP}/.roll/briefs/2026-05-17-01.md" << 'EOF'
# 简报 2026-05-17 12:00

> 触发：手动 | 覆盖：2026-05-15 15:30 → 2026-05-17 12:00

## 已完成（3 项）

| 编号 | 描述 | 类型 |
|----|-------------|------|
| US-LOOP-001 | 带颜色的事件流实时渲染 | 用户故事 |
| US-AUTO-041 | loop 自动修复 CI 红 | 用户故事 |
| FIX-047 | loop 过早标 Done 修复 | 缺陷 |

## 进行中

| 编号 | 描述 |
|----|-------------|
| US-DOC-011 | features.md 区分规划中 |

## 待处理队列（2 项）

| 编号 | 描述 | 优先级 |
|----|-------------|----------|
| FIX-045 | 孤儿分支恢复问题 | 高 |
| FIX-046 | roll ci --wait 死等 | 高 |

## 需人工介入

1. **孤儿恢复**（2026-05-16 21:04 UTC）：US-DOC-011 被自动回退
2. **PR 发布失败**（2026-05-17 01:17 UTC）：gh pr create 连续失败

---
*状态：进行中 1 · 待处理 2 · 告警 2 | 下次简报：2026-05-18 08:00*
EOF
}

# ── Golden path ───────────────────────────────────────────────────────────────

@test "brief e2e: v2 shows SUMMARY section" {
  _make_project_brief
  run_roll brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUMMARY"* ]]
}

@test "brief e2e: v2 shows HIGHLIGHTS with completed story IDs" {
  _make_project_brief
  run_roll brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"HIGHLIGHTS"* ]]
  [[ "$output" == *"US-LOOP-001"* ]]
}

@test "brief e2e: v2 shows DECIDE section with D1/D2 numbering" {
  _make_project_brief
  run_roll brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"DECIDE"* ]]
  [[ "$output" == *"D1"* ]]
  [[ "$output" == *"D2"* ]]
}

@test "brief e2e: v2 shows shipped count in summary" {
  _make_project_brief
  run_roll brief
  [ "$status" -eq 0 ]
  # 3 shipped items
  [[ "$output" == *"3 Shipped"* ]]
}

@test "brief e2e: v2 shows watch count for in-progress items" {
  _make_project_brief
  run_roll brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"Watch"* ]]
}

@test "brief e2e: ROLL_UI=v1 falls back to raw markdown output" {
  _make_project_brief
  ROLL_UI=v1 run_roll brief
  [ "$status" -eq 0 ]
  # v1 cats the raw markdown — check for markdown heading
  [[ "$output" == *"简报"* ]]
  # v1 should NOT show the Python section headers
  [[ "$output" != *"SUMMARY"* ]]
}
