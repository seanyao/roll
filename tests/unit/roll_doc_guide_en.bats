#!/usr/bin/env bats
# Tests for US-DOC-001: docs/guide/en/ English user guides

GUIDE_DIR="${BATS_TEST_DIRNAME}/../../docs/guide/en"

@test "overview.md covers three-layer model" {
  grep -qi "three.layer\|autonomous layer\|loop.*dream.*peer\|human.*loop.*dream" "${GUIDE_DIR}/overview.md"
}

@test "loop.md documents roll loop on/off" {
  grep -qF 'roll loop on' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop off' "${GUIDE_DIR}/loop.md"
}

@test "loop.md documents all key subcommands" {
  grep -qF 'roll loop now' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop status' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop attach' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop mute' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop pause' "${GUIDE_DIR}/loop.md"
  grep -qF 'roll loop runs' "${GUIDE_DIR}/loop.md"
}

@test "dream.md explains nightly code health scan" {
  grep -qiE "nightly|night|scheduled|3am|health|scan" "${GUIDE_DIR}/dream.md"
}

@test "dream.md mentions REFACTOR item generation" {
  grep -qiE "REFACTOR|refactor" "${GUIDE_DIR}/dream.md"
}

@test "peer.md documents AGREE/REFINE/OBJECT/ESCALATE states" {
  grep -qF 'AGREE' "${GUIDE_DIR}/peer.md"
  grep -qF 'REFINE' "${GUIDE_DIR}/peer.md"
  grep -qF 'OBJECT' "${GUIDE_DIR}/peer.md"
  grep -qF 'ESCALATE' "${GUIDE_DIR}/peer.md"
}

@test "peer.md explains roll peer command" {
  grep -qF 'roll peer' "${GUIDE_DIR}/peer.md"
}

# ─── E2E golden path: cross-references and doc completeness ──────────────────

@test "e2e: overview.md links to loop.md, dream.md, peer.md" {
  grep -qF 'loop.md' "${GUIDE_DIR}/overview.md"
  grep -qF 'dream.md' "${GUIDE_DIR}/overview.md"
  grep -qF 'peer.md' "${GUIDE_DIR}/overview.md"
}

@test "e2e: loop.md covers tmux session naming roll-loop-" {
  grep -qF 'roll-loop-' "${GUIDE_DIR}/loop.md"
}

@test "e2e: dream.md mentions docs/dream/ output directory" {
  grep -qF 'docs/dream/' "${GUIDE_DIR}/dream.md"
}

@test "e2e: peer.md covers mute shared with loop" {
  grep -qiE 'mute|~/.shared/roll/mute' "${GUIDE_DIR}/peer.md"
}
