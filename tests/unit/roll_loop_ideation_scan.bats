#!/usr/bin/env bats
# US-AUTO-047: _loop_ideation_scan scans backlog for unconverted IDEA rows,
# evaluates simplicity, and outputs a structured JSON candidate list.

load helpers

setup() {
  unit_setup_cd
  mkdir -p .roll/features/test
}

teardown() { unit_teardown_cd; }

write_backlog() {
  cat > .roll/backlog.md
}

# ─── No candidates ────────────────────────────────────────────────────────────

@test "ideation_scan: empty backlog → []" {
  write_backlog <<'MD'
# Project Backlog
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "ideation_scan: only converted IDEA rows → []" {
  write_backlog <<'MD'
| [IDEA-001](.roll/features/test/t.md#idea-001) | simple doc fix | ✅ 已转 US-AUTO-001 |
| [IDEA-002](.roll/features/test/t.md#idea-002) | another one | ✅ Done |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "ideation_scan: missing backlog file → []" {
  source "$ROLL_BIN"
  run _loop_ideation_scan ".roll/missing.md"
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

# ─── Candidate detection ──────────────────────────────────────────────────────

@test "ideation_scan: simple IDEA → candidate, no peer" {
  write_backlog <<'MD'
| [IDEA-010](.roll/features/test/t.md#idea-010) | 加一条简单文档说明 | 📋 Todo |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":"IDEA-010"'* ]]
  [[ "$output" == *'"verdict":"candidate"'* ]]
  [[ "$output" == *'"peer":false'* ]]
}

@test "ideation_scan: complex IDEA → manual" {
  write_backlog <<'MD'
| [IDEA-020](.roll/features/test/t.md#idea-020) | 大范围重构核心模块 | 📋 Todo |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":"IDEA-020"'* ]]
  [[ "$output" == *'"verdict":"manual"'* ]]
  [[ "$output" == *'"peer":false'* ]]
}

@test "ideation_scan: borderline IDEA → candidate, peer=true" {
  write_backlog <<'MD'
| [IDEA-030](.roll/features/test/t.md#idea-030) | 改进用户反馈流程 | 📋 Todo |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":"IDEA-030"'* ]]
  [[ "$output" == *'"verdict":"candidate"'* ]]
  [[ "$output" == *'"peer":true'* ]]
}

@test "ideation_scan: mixed rows, only unconverted IDEA picked" {
  write_backlog <<'MD'
| [US-A-001](.roll/features/test/t.md#us-a-001) | product story | 📋 Todo |
| [IDEA-040](.roll/features/test/t.md#idea-040) | 修复一个小bug | 📋 Todo |
| [IDEA-041](.roll/features/test/t.md#idea-041) | 大范围架构调整 | 📋 Todo |
| [FIX-A-001](.roll/features/test/t.md#fix-a-001) | bug fix | 📋 Todo |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  # Should contain the simple IDEA
  [[ "$output" == *'"id":"IDEA-040"'* ]]
  [[ "$output" == *'"verdict":"candidate"'* ]]
  # Should contain the complex IDEA as manual
  [[ "$output" == *'"id":"IDEA-041"'* ]]
  [[ "$output" == *'"verdict":"manual"'* ]]
  # Should NOT contain US or FIX rows
  [[ "$output" != *'US-A-001'* ]]
  [[ "$output" != *'FIX-A-001'* ]]
}

# ─── Limit gate ───────────────────────────────────────────────────────────────

@test "ideation_scan: limit caps output" {
  write_backlog <<'MD'
| [IDEA-050](.roll/features/test/t.md#idea-050) | 简单文案修正 | 📋 Todo |
| [IDEA-051](.roll/features/test/t.md#idea-051) | 补一个缺失的文档 | 📋 Todo |
| [IDEA-052](.roll/features/test/t.md#idea-052) | 改个颜色 | 📋 Todo |
| [IDEA-053](.roll/features/test/t.md#idea-053) | 微调间距 | 📋 Todo |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan ".roll/backlog.md" "2"
  [ "$status" -eq 0 ]
  # Count IDEA ids in output
  local n
  n=$(printf '%s' "$output" | grep -oE 'IDEA-[0-9]+' | wc -l | tr -d ' ')
  [ "$n" -eq 2 ]
}

@test "ideation_scan: ROLL_IDEATION_LIMIT env overrides default" {
  write_backlog <<'MD'
| [IDEA-060](.roll/features/test/t.md#idea-060) | 简单文案修正 | 📋 Todo |
| [IDEA-061](.roll/features/test/t.md#idea-061) | 补一个缺失的文档 | 📋 Todo |
| [IDEA-062](.roll/features/test/t.md#idea-062) | 改个颜色 | 📋 Todo |
MD
  source "$ROLL_BIN"
  ROLL_IDEATION_LIMIT=1 run _loop_ideation_scan
  [ "$status" -eq 0 ]
  local n
  n=$(printf '%s' "$output" | grep -oE 'IDEA-[0-9]+' | wc -l | tr -d ' ')
  [ "$n" -eq 1 ]
}

@test "ideation_scan: invalid limit falls back to 3" {
  write_backlog <<'MD'
| [IDEA-070](.roll/features/test/t.md#idea-070) | 简单文案修正 | 📋 Todo |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan ".roll/backlog.md" "abc"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":"IDEA-070"'* ]]
}

# ─── Skip converted / hold / done ─────────────────────────────────────────────

@test "ideation_scan: skips Hold IDEA" {
  write_backlog <<'MD'
| [IDEA-080](.roll/features/test/t.md#idea-080) | 简单修复 | 🚫 Hold |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "ideation_scan: skips Done IDEA" {
  write_backlog <<'MD'
| [IDEA-081](.roll/features/test/t.md#idea-081) | 简单修复 | ✅ Done |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "ideation_scan: skips IDEA with arrow conversion marker" {
  write_backlog <<'MD'
| [IDEA-082](.roll/features/test/t.md#idea-082) | 简单修复 | ✅ 已转 US-AUTO-082 |
MD
  source "$ROLL_BIN"
  run _loop_ideation_scan
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}
