#!/usr/bin/env bats
# Unit tests for: roll brief v2 redesign (US-VIEW-006)

ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

setup() {
  TEST_DIR="$(mktemp -d)"
  export NO_COLOR=1
  export TERM=dumb
  mkdir -p "${TEST_DIR}/.roll/briefs"
}

teardown() {
  rm -rf "$TEST_DIR"
}

_make_brief() {
  cat > "${TEST_DIR}/.roll/briefs/2026-05-17-01.md" << 'EOF'
# 简报 2026-05-17 12:00

> 触发：手动 | 覆盖：2026-05-15 15:30 → 2026-05-17 12:00

## 已完成（3 项）

| 编号 | 描述 | 类型 |
|----|-------------|------|
| US-LOOP-001 | 带颜色的事件流实时渲染 | 用户故事 |
| US-AUTO-041 | loop 自动修复 CI 红 | 用户故事 |
| FIX-047 | loop 过早标 Done 问题修复 | 缺陷 |

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

## 发版就绪

⚠️ **暂缓** — 原因：US-DOC-011 仍进行中

---
*状态：进行中 1 · 待处理 2 · 告警 2 | 下次简报：2026-05-18 08:00*
EOF
}

@test "brief v2: ROLL_UI=v2 routes to Python implementation" {
  _make_brief
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"BRIEF"* ]] || [[ "$output" == *"SUMMARY"* ]]
}

@test "brief v2: ROLL_UI=v1 uses legacy bash cat implementation" {
  _make_brief
  cd "$TEST_DIR"
  run env ROLL_UI=v1 bash "$ROLL_BIN" brief
  [ "$status" -eq 0 ]
  # v1 just cats the raw markdown — check for raw markdown content
  [[ "$output" == *"简报"* ]]
}

@test "brief v2: shows SUMMARY section" {
  _make_brief
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUMMARY"* ]]
}

@test "brief v2: shows HIGHLIGHTS from completed items" {
  _make_brief
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"HIGHLIGHTS"* ]]
  [[ "$output" == *"US-LOOP-001"* ]]
}

@test "brief v2: shows DECIDE section with D1/D2 numbering" {
  _make_brief
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" brief
  [ "$status" -eq 0 ]
  [[ "$output" == *"DECIDE"* ]]
  [[ "$output" == *"D1"* ]]
  [[ "$output" == *"D2"* ]]
}

@test "brief v2: shows shipped count in summary" {
  _make_brief
  cd "$TEST_DIR"
  run env ROLL_UI=v2 bash "$ROLL_BIN" brief
  [ "$status" -eq 0 ]
  # 3 completed items should appear somewhere in summary numbers
  [[ "$output" == *"3"* ]]
}

@test "brief v2: Python renderer exits non-zero when no brief file exists" {
  # Test the Python script directly — no skill invocation, so no hang
  cd "$TEST_DIR"
  run python3 "${ROLL_BIN%/bin/roll}/lib/roll-brief.py" 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" == *"No brief"* ]] || [[ "$output" == *"no brief"* ]]
}
