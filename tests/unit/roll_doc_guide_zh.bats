#!/usr/bin/env bats
# Tests for US-DOC-002: docs/guide/zh/ Chinese user guides

GUIDE_DIR="${BATS_TEST_DIRNAME}/../../docs/guide/zh"

@test "docs/guide/zh/ directory exists" {
  [ -d "$GUIDE_DIR" ]
}

@test "zh overview.md exists" {
  [ -f "${GUIDE_DIR}/overview.md" ]
}

@test "zh loop.md exists" {
  [ -f "${GUIDE_DIR}/loop.md" ]
}

@test "zh dream.md exists" {
  [ -f "${GUIDE_DIR}/dream.md" ]
}

@test "zh peer.md exists" {
  [ -f "${GUIDE_DIR}/peer.md" ]
}

@test "zh overview.md covers three-layer autonomous model" {
  grep -qiE "三层|自主|loop.*dream.*peer|human.*loop" "${GUIDE_DIR}/overview.md"
}

@test "zh loop.md documents roll loop on/off" {
  grep -qF 'roll loop on' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop off' "${GUIDE_DIR}/loop.md"
}

@test "zh loop.md documents all key subcommands" {
  grep -qF 'roll loop now' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop status' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop attach' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop mute' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop pause' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop runs' "${GUIDE_DIR}/loop.md"
}

@test "zh dream.md explains nightly scan" {
  grep -qiE "夜间|每晚|3点|定时|3am|nightly" "${GUIDE_DIR}/dream.md"
}

@test "zh dream.md mentions REFACTOR generation" {
  grep -qiE "REFACTOR|重构" "${GUIDE_DIR}/dream.md"
}

@test "zh peer.md documents AGREE/REFINE/OBJECT/ESCALATE states" {
  grep -qF 'AGREE' "${GUIDE_DIR}/peer.md"
  grep -qF 'REFINE' "${GUIDE_DIR}/peer.md"
  grep -qF 'OBJECT' "${GUIDE_DIR}/peer.md"
  grep -qF 'ESCALATE' "${GUIDE_DIR}/peer.md"
}

@test "zh peer.md documents roll peer command" {
  grep -qF 'roll peer' "${GUIDE_DIR}/peer.md"
}

# ─── E2E golden path ──────────────────────────────────────────────────────────

@test "e2e: zh overview.md links to loop.md, dream.md, peer.md" {
  grep -qF 'loop.md' "${GUIDE_DIR}/overview.md"
  grep -qF 'dream.md' "${GUIDE_DIR}/overview.md"
  grep -qF 'peer.md' "${GUIDE_DIR}/overview.md"
}

@test "e2e: zh loop.md consistent with en on tmux" {
  grep -qiF 'tmux' "${GUIDE_DIR}/loop.md"
}

@test "e2e: zh peer.md covers mute mechanism" {
  grep -qiE 'mute|静音' "${GUIDE_DIR}/peer.md"
}
