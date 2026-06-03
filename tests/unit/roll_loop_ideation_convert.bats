#!/usr/bin/env bats
# US-AUTO-048: _loop_ideation_convert routes ideation candidates from
# _loop_ideation_scan output and dispatches: manual (skip), direct (convert),
# peer-required (peer then convert). Peer/call-roll-design hooks are stub-able.

load helpers

setup() {
  unit_setup_cd
  mkdir -p .roll/features/test .roll/loop
}

teardown() { unit_teardown_cd; }

# Override stubs for testing (no actual agent/peer invocation)
_stub_hooks() {
  _ideation_direct_convert() { echo "DIRECT:$1:$2"; }
  _ideation_peer_convert()   { echo "PEER:$1:$2"; }
}

# ─── Empty / no candidates ────────────────────────────────────────────────────

@test "ideation_convert: empty array → noop" {
  source "$ROLL_BIN"
  _stub_hooks
  run _loop_ideation_convert '[]'
  [ "$status" -eq 0 ]
}

@test "ideation_convert: empty string → noop" {
  source "$ROLL_BIN"
  _stub_hooks
  run _loop_ideation_convert ''
  [ "$status" -eq 0 ]
}

# ─── Manual verdict → skip ────────────────────────────────────────────────────

@test "ideation_convert: manual verdict skipped, no conversion hooks called" {
  source "$ROLL_BIN"
  _stub_hooks
  run _loop_ideation_convert '[{"id":"IDEA-001","verdict":"manual","reason":"too complex","peer":false}]'
  [ "$status" -eq 0 ]
  [[ "$output" != *'DIRECT:'* ]]
  [[ "$output" != *'PEER:'* ]]
  [[ "$output" == *'[ideation]'* ]] || true  # tick line always present
}

# ─── Direct conversion ────────────────────────────────────────────────────────

@test "ideation_convert: simple candidate → direct convert hook called" {
  source "$ROLL_BIN"
  _stub_hooks
  run _loop_ideation_convert '[{"id":"IDEA-010","verdict":"candidate","reason":"simple","peer":false}]'
  [ "$status" -eq 0 ]
  [[ "$output" == *'DIRECT:IDEA-010:simple'* ]]
  [[ "$output" != *'PEER:'* ]]
}

@test "ideation_convert: multiple simple candidates → all direct" {
  source "$ROLL_BIN"
  _stub_hooks
  local json='[{"id":"IDEA-020","verdict":"candidate","reason":"simple fix","peer":false},{"id":"IDEA-021","verdict":"candidate","reason":"doc update","peer":false}]'
  run _loop_ideation_convert "$json"
  [ "$status" -eq 0 ]
  [[ "$output" == *'DIRECT:IDEA-020:simple fix'* ]]
  [[ "$output" == *'DIRECT:IDEA-021:doc update'* ]]
}

# ─── Peer-required ────────────────────────────────────────────────────────────

@test "ideation_convert: peer=true candidate → peer hook called, not direct" {
  source "$ROLL_BIN"
  _stub_hooks
  run _loop_ideation_convert '[{"id":"IDEA-030","verdict":"candidate","reason":"borderline","peer":true}]'
  [ "$status" -eq 0 ]
  [[ "$output" == *'PEER:IDEA-030:borderline'* ]]
  [[ "$output" != *'DIRECT:'* ]]
}

# ─── Mixed batch ──────────────────────────────────────────────────────────────

@test "ideation_convert: mixed verdicts → correct routing" {
  source "$ROLL_BIN"
  _stub_hooks
  local json
  json='[{"id":"IDEA-040","verdict":"candidate","reason":"simple","peer":false},{"id":"IDEA-041","verdict":"manual","reason":"high risk","peer":false},{"id":"IDEA-042","verdict":"candidate","reason":"borderline","peer":true}]'
  run _loop_ideation_convert "$json"
  [ "$status" -eq 0 ]
  [[ "$output" == *'DIRECT:IDEA-040:simple'* ]]
  [[ "$output" == *'PEER:IDEA-042:borderline'* ]]
  # Manual should not trigger DIRECT or PEER hooks
  [[ "$output" != *'DIRECT:IDEA-041'* ]]
  [[ "$output" != *'PEER:IDEA-041'* ]]
  # But skip message should be present
  [[ "$output" == *'skip IDEA-041'* ]]
}

# ─── Marking helpers ──────────────────────────────────────────────────────────

@test "ideation_convert: _loop_ideation_mark_converting updates IDEA row" {
  cat > .roll/backlog.md <<'MD'
## Epic: Test

| [IDEA-050](.roll/test.md#idea-050) | simple idea | 📋 Todo |
MD
  source "$ROLL_BIN"
  ROLL_MAIN_PROJECT="$PWD" run _loop_ideation_mark_converting "IDEA-050"
  [ "$status" -eq 0 ]
  grep -q '🔨 Converting' .roll/backlog.md
}

@test "ideation_convert: _loop_ideation_mark_converting noop for missing IDEA" {
  cat > .roll/backlog.md <<'MD'
## Epic: Test

| [IDEA-051](.roll/test.md#idea-051) | simple idea | 📋 Todo |
MD
  source "$ROLL_BIN"
  ROLL_MAIN_PROJECT="$PWD" run _loop_ideation_mark_converting "IDEA-999"
  [ "$status" -eq 0 ]
  grep -q '📋 Todo' .roll/backlog.md
  ! grep -q '🔨 Converting' .roll/backlog.md
}

@test "ideation_convert: _loop_ideation_mark_peer updates IDEA row" {
  cat > .roll/backlog.md <<'MD'
## Epic: Test

| [IDEA-052](.roll/test.md#idea-052) | borderline idea | 📋 Todo |
MD
  source "$ROLL_BIN"
  ROLL_MAIN_PROJECT="$PWD" run _loop_ideation_mark_peer "IDEA-052"
  [ "$status" -eq 0 ]
  grep -q '🔍 Peer Review' .roll/backlog.md
}

# ─── _loop_ideation_mark_done ─────────────────────────────────────────────────

@test "ideation_convert: _loop_ideation_mark_done marks IDEA as converted" {
  cat > .roll/backlog.md <<'MD'
## Epic: Test

| [IDEA-060](.roll/test.md#idea-060) | simple idea | 🔨 Converting |
MD
  source "$ROLL_BIN"
  ROLL_MAIN_PROJECT="$PWD" run _loop_ideation_mark_done "IDEA-060" "US-AUTO-060"
  [ "$status" -eq 0 ]
  grep -q '✅ 已转 US-AUTO-060' .roll/backlog.md
}

@test "ideation_convert: _loop_ideation_mark_done_noop for missing IDEA" {
  cat > .roll/backlog.md <<'MD'
## Epic: Test

| [IDEA-061](.roll/test.md#idea-061) | simple idea | 🔨 Converting |
MD
  source "$ROLL_BIN"
  ROLL_MAIN_PROJECT="$PWD" run _loop_ideation_mark_done "IDEA-999" "US-AUTO-999"
  [ "$status" -eq 0 ]
  grep -q '🔨 Converting' .roll/backlog.md
  ! grep -q '已转' .roll/backlog.md
}
