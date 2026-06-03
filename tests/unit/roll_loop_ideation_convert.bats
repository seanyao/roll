#!/usr/bin/env bats
# US-AUTO-048: _loop_ideation_convert auto-converts simple IDEA candidates to US
# via roll-design, with peer-review gate for borderline candidates.

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

@test "ideation_convert: empty backlog does nothing" {
  write_backlog <<'MD'
# Project Backlog
MD
  source "$ROLL_BIN"
  run _loop_ideation_convert
  [ "$status" -eq 0 ]
}

@test "ideation_convert: manual-only scan does nothing" {
  write_backlog <<'MD'
| [IDEA-001](.roll/features/test/t.md#idea-001) | 大范围重构核心模块 | 📋 Todo |
MD
  source "$ROLL_BIN"
  run _loop_ideation_convert
  [ "$status" -eq 0 ]
}

# ─── Simple candidate ─────────────────────────────────────────────────────────

@test "ideation_convert: simple candidate calls design and updates backlog" {
  write_backlog <<'MD'
| [IDEA-010](.roll/features/test/t.md#idea-010) | 加一条简单文档说明 | 📋 Todo |
MD
  source "$ROLL_BIN"

  # Stub design to simulate successful conversion (annotate backlog)
  _loop_ideation_design() {
    local idea_id="$1"
    sed -i.bak "s/| 加一条简单文档说明 |/| 加一条简单文档说明 → US-AUTO-010 |/" .roll/backlog.md
    rm -f .roll/backlog.md.bak
    return 0
  }

  run _loop_ideation_convert
  [ "$status" -eq 0 ]
  grep -q 'IDEA-010.*→ US-AUTO-010' .roll/backlog.md
}

# ─── Complex candidate ────────────────────────────────────────────────────────

@test "ideation_convert: complex candidate is skipped" {
  write_backlog <<'MD'
| [IDEA-020](.roll/features/test/t.md#idea-020) | 大范围重构核心模块 | 📋 Todo |
MD
  source "$ROLL_BIN"

  local _tracker; _tracker=$(mktemp)
  _loop_ideation_design() { echo "$1" >> "$_tracker"; return 0; }

  run _loop_ideation_convert
  [ "$status" -eq 0 ]
  [ ! -s "$_tracker" ]   # design was never called
  rm -f "$_tracker"
}

# ─── Peer candidate AGREE ─────────────────────────────────────────────────────

@test "ideation_convert: peer candidate with AGREE proceeds to design" {
  write_backlog <<'MD'
| [IDEA-030](.roll/features/test/t.md#idea-030) | 改进用户反馈流程 | 📋 Todo |
MD
  source "$ROLL_BIN"

  _loop_ideation_peer() { echo "AGREE"; }
  _loop_ideation_design() {
    sed -i.bak 's/| 改进用户反馈流程 |/| 改进用户反馈流程 → US-AUTO-030 |/' .roll/backlog.md
    rm -f .roll/backlog.md.bak
    return 0
  }

  run _loop_ideation_convert
  [ "$status" -eq 0 ]
  grep -q 'IDEA-030.*→ US-AUTO-030' .roll/backlog.md
}

# ─── Peer candidate OBJECT ────────────────────────────────────────────────────

@test "ideation_convert: peer candidate with OBJECT is skipped and annotated" {
  write_backlog <<'MD'
| [IDEA-040](.roll/features/test/t.md#idea-040) | 改进用户反馈流程 | 📋 Todo |
MD
  source "$ROLL_BIN"

  local _tracker; _tracker=$(mktemp)
  _loop_ideation_peer() { echo "OBJECT"; }
  _loop_ideation_design() { echo "$1" >> "$_tracker"; return 0; }

  run _loop_ideation_convert
  [ "$status" -eq 0 ]
  [ ! -s "$_tracker" ]   # design was never called
  rm -f "$_tracker"
  grep -q 'IDEA-040.*peer OBJECT' .roll/backlog.md
}

# ─── Mixed candidates ─────────────────────────────────────────────────────────

@test "ideation_convert: mixed rows route correctly" {
  write_backlog <<'MD'
| [IDEA-050](.roll/features/test/t.md#idea-050) | 加一条简单文档说明 | 📋 Todo |
| [IDEA-051](.roll/features/test/t.md#idea-051) | 大范围重构核心模块 | 📋 Todo |
| [IDEA-052](.roll/features/test/t.md#idea-052) | 改进用户反馈流程 | 📋 Todo |
MD
  source "$ROLL_BIN"

  local _design_tracker _peer_tracker
  _design_tracker=$(mktemp)
  _peer_tracker=$(mktemp)
  _loop_ideation_peer() { echo "$1" >> "$_peer_tracker"; echo "OBJECT"; }
  _loop_ideation_design() { echo "$1" >> "$_design_tracker"; return 0; }

  run _loop_ideation_convert
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$_design_tracker")" -eq 1 ]   # only simple IDEA-050
  grep -q 'IDEA-050' "$_design_tracker"
  [ "$(wc -l < "$_peer_tracker")" -eq 1 ]     # only borderline IDEA-052
  grep -q 'IDEA-052' "$_peer_tracker"
  rm -f "$_design_tracker" "$_peer_tracker"
}

# ─── Design failure recovery ──────────────────────────────────────────────────

@test "ideation_convert: design failure leaves IDEA unconverted" {
  write_backlog <<'MD'
| [IDEA-060](.roll/features/test/t.md#idea-060) | 加一条简单文档说明 | 📋 Todo |
MD
  source "$ROLL_BIN"

  _loop_ideation_design() { return 1; }

  run _loop_ideation_convert
  [ "$status" -eq 0 ]
  ! grep -q 'IDEA-060.*→ US-' .roll/backlog.md
}
