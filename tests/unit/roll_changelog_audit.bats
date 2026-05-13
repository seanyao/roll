#!/usr/bin/env bats
# Unit tests for: _changelog_audit_bullet, _changelog_audit_log,
# _changelog_audit_gate (US-CL-005)

load helpers

setup() {
  unit_setup_cd
  export ROLL_CHANGELOG_AUDIT_LOG="$TEST_TMP/audit.jsonl"
  _LOOP_ALERT="$TEST_TMP/ALERT.md"
}
teardown() { unit_teardown_cd; }

# ─── _changelog_audit_bullet ───────────────────────────────────────────────

@test "_changelog_audit_bullet: clean short user-facing bullet passes" {
  run _changelog_audit_bullet "- **Added**: 升级 — 一键到新版"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_changelog_audit_bullet: rejects bullet over 30 chars without backtick" {
  run _changelog_audit_bullet "- **Added**: 这是一条没有反引号但是字数明显超过三十的描述真的很长"
  echo "$output" | grep -q over-length-30
}

@test "_changelog_audit_bullet: allows long bullet when wrapped user command in backticks" {
  run _changelog_audit_bullet '- **Added**: `roll edit notes.md` 直接打开编辑笔记非常方便快捷'
  ! echo "$output" | grep -q over-length-30
}

@test "_changelog_audit_bullet: rejects backtick identifier with underscore" {
  run _changelog_audit_bullet '- **Fixed**: `_foo_bar` 不再崩溃'
  echo "$output" | grep -q internal-id
}

@test "_changelog_audit_bullet: rejects backtick identifier with fn() form" {
  run _changelog_audit_bullet '- **Fixed**: `compute()` 修复'
  echo "$output" | grep -q internal-id
}

@test "_changelog_audit_bullet: accepts backtick user command (no _ no ())" {
  run _changelog_audit_bullet '- **Added**: `roll loop on` — 启动 loop'
  ! echo "$output" | grep -q internal-id
}

@test "_changelog_audit_bullet: rejects file suffix outside backticks" {
  run _changelog_audit_bullet "- **Added**: 改 release.sh — 升级"
  echo "$output" | grep -q path-or-suffix
}

@test "_changelog_audit_bullet: rejects path fragment outside backticks" {
  run _changelog_audit_bullet "- **Fixed**: bin/roll 不再崩溃"
  echo "$output" | grep -q path-or-suffix
}

@test "_changelog_audit_bullet: allows path inside backticks" {
  run _changelog_audit_bullet '- **Added**: `ls docs/` — 查目录'
  ! echo "$output" | grep -q path-or-suffix
}

@test "_changelog_audit_bullet: rejects Phase N" {
  run _changelog_audit_bullet "- **Added**: Phase 5 — 新增 lint"
  echo "$output" | grep -q phase-step
}

@test "_changelog_audit_bullet: rejects Step N" {
  run _changelog_audit_bullet "- **Added**: Step 11 — 加 gate"
  echo "$output" | grep -q phase-step
}

@test "_changelog_audit_bullet: rejects bullet without — and without 不再/现在" {
  run _changelog_audit_bullet "- **Added**: 升级到新版本"
  echo "$output" | grep -q bad-shape
}

@test "_changelog_audit_bullet: accepts bullet with em dash" {
  run _changelog_audit_bullet "- **Added**: 升级 — 一键到最新版"
  ! echo "$output" | grep -q bad-shape
}

@test "_changelog_audit_bullet: accepts bullet with 不再" {
  run _changelog_audit_bullet "- **Fixed**: 启动 不再卡顿"
  ! echo "$output" | grep -q bad-shape
}

@test "_changelog_audit_bullet: accepts bullet with 现在" {
  run _changelog_audit_bullet "- **Changed**: 启动 现在更快"
  ! echo "$output" | grep -q bad-shape
}

@test "_changelog_audit_bullet: surfaces multiple violations at once" {
  run _changelog_audit_bullet '- **Fixed**: Phase 5 给 `_foo()` 加 lint 到 bin/roll'
  local lines; lines=$(echo "$output" | grep -c '^[a-z]')
  [ "$lines" -ge 2 ]
}

# ─── _changelog_audit_log ─────────────────────────────────────────────────

@test "_changelog_audit_log: writes one JSONL line per call" {
  _changelog_audit_log pass 1 "- **Added**: 升级 — 一键"
  _changelog_audit_log fail 2 "- **Added**: bad" over-length-30
  [ -f "$ROLL_CHANGELOG_AUDIT_LOG" ]
  local lines; lines=$(wc -l < "$ROLL_CHANGELOG_AUDIT_LOG" | tr -d ' ')
  [ "$lines" -eq 2 ]
}

@test "_changelog_audit_log: jsonl record has required fields" {
  _changelog_audit_log fail 1 "- **Added**: x" over-length-30 phase-step
  local line; line=$(tail -n 1 "$ROLL_CHANGELOG_AUDIT_LOG")
  echo "$line" | jq -e '.ts and .verdict == "fail" and .round == 1 and .bullet and (.reasons | length == 2)' >/dev/null
}

@test "_changelog_audit_log: reasons array empty when pass" {
  _changelog_audit_log pass 1 "- **Added**: 升级 — 一键"
  local line; line=$(tail -n 1 "$ROLL_CHANGELOG_AUDIT_LOG")
  echo "$line" | jq -e '.reasons == []' >/dev/null
}

# ─── _changelog_audit_gate ────────────────────────────────────────────────

@test "_changelog_audit_gate: passes on first clean bullet" {
  run _changelog_audit_gate "- **Added**: 升级 — 一键到最新"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "升级"
  # one JSONL record (round 1 pass)
  [ "$(wc -l < "$ROLL_CHANGELOG_AUDIT_LOG" | tr -d ' ')" -eq 1 ]
}

@test "_changelog_audit_gate: accepts a later rewrite (round 2)" {
  run _changelog_audit_gate \
    "- **Added**: Phase 5 — 加 gate" \
    "- **Added**: 升级 — 一键到最新"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "升级"
  [ "$(wc -l < "$ROLL_CHANGELOG_AUDIT_LOG" | tr -d ' ')" -eq 2 ]
}

@test "_changelog_audit_gate: all 3 rounds fail → ⚠️ marker + ALERT + exit 1" {
  run _changelog_audit_gate \
    "- **Added**: Phase 5 — 加 gate" \
    "- **Added**: Step 6 — 加 gate" \
    "- **Added**: Phase 7 — 加 gate"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q '⚠️'
  [ -f "$_LOOP_ALERT" ]
  grep -q "changelog audit" "$_LOOP_ALERT"
  # 3 fail records
  [ "$(wc -l < "$ROLL_CHANGELOG_AUDIT_LOG" | tr -d ' ')" -eq 3 ]
}

@test "_changelog_audit_gate: stops after 3 candidates even if more passed in" {
  run _changelog_audit_gate \
    "- **Added**: Phase 5 — 加 gate" \
    "- **Added**: Step 6 — 加 gate" \
    "- **Added**: Phase 7 — 加 gate" \
    "- **Added**: 升级 — 一键"
  # 4th candidate is clean but gate caps at 3
  [ "$status" -eq 1 ]
  [ "$(wc -l < "$ROLL_CHANGELOG_AUDIT_LOG" | tr -d ' ')" -eq 3 ]
}
