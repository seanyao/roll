#!/usr/bin/env bats
# Tests for _loop_tcr_count / _loop_enforce_tcr — TCR enforcement (US-AUTO-010)

load helpers
setup() {
  unit_setup_cd
  _test_repo="$TEST_TMP"
  git init -q
  git config user.email "test@roll.dev"
  git config user.name "Test"
  mkdir -p .roll
  _LOOP_ALERT="${TEST_TMP}/.alert"
}
teardown() { unit_teardown_cd; }

# ─── _loop_tcr_count ──────────────────────────────────────────────────────────

@test "_loop_tcr_count: returns 1 for one tcr commit after started_at" {
  local started_at="2026-01-01T00:00:00+0000"
  GIT_COMMITTER_DATE="2026-01-02T00:00:00+0000" git commit \
    --date="2026-01-02T00:00:00+0000" --allow-empty -m "tcr: add feature" -q

  local count; count=$(_loop_tcr_count "$started_at")
  [ "$count" -eq 1 ]
}

@test "_loop_tcr_count: returns 0 when tcr commits are before started_at" {
  GIT_COMMITTER_DATE="2026-01-01T00:00:00+0000" git commit \
    --date="2026-01-01T00:00:00+0000" --allow-empty -m "tcr: old feature" -q

  local started_at="2026-01-02T00:00:00+0000"
  local count; count=$(_loop_tcr_count "$started_at")
  [ "$count" -eq 0 ]
}

@test "_loop_tcr_count: ignores non-tcr commits after started_at" {
  local started_at="2026-01-01T00:00:00+0000"
  GIT_COMMITTER_DATE="2026-01-02T00:00:00+0000" git commit \
    --date="2026-01-02T00:00:00+0000" --allow-empty -m "fix: something else" -q
  GIT_COMMITTER_DATE="2026-01-02T01:00:00+0000" git commit \
    --date="2026-01-02T01:00:00+0000" --allow-empty -m "chore: update docs" -q

  local count; count=$(_loop_tcr_count "$started_at")
  [ "$count" -eq 0 ]
}

@test "_loop_tcr_count: counts multiple tcr commits" {
  local started_at="2026-01-01T00:00:00+0000"
  GIT_COMMITTER_DATE="2026-01-02T00:00:00+0000" git commit \
    --date="2026-01-02T00:00:00+0000" --allow-empty -m "tcr: step 1" -q
  GIT_COMMITTER_DATE="2026-01-02T01:00:00+0000" git commit \
    --date="2026-01-02T01:00:00+0000" --allow-empty -m "tcr: step 2" -q
  GIT_COMMITTER_DATE="2026-01-02T02:00:00+0000" git commit \
    --date="2026-01-02T02:00:00+0000" --allow-empty -m "chore: docs" -q

  local count; count=$(_loop_tcr_count "$started_at")
  [ "$count" -eq 2 ]
}

# ─── _loop_enforce_tcr ────────────────────────────────────────────────────────

@test "_loop_enforce_tcr: returns 0 when tcr commits exist" {
  printf '| [US-TEST-001](x.md) | test | ✅ Done |\n' > .roll/backlog.md

  local started_at="2026-01-01T00:00:00+0000"
  GIT_COMMITTER_DATE="2026-01-02T00:00:00+0000" git commit \
    --date="2026-01-02T00:00:00+0000" --allow-empty -m "tcr: add test" -q

  run _loop_enforce_tcr "US-TEST-001" "$started_at"
  [ "$status" -eq 0 ]
  grep -q "✅ Done" .roll/backlog.md
}

@test "_loop_enforce_tcr: returns 1 and reverts story when no tcr commits" {
  printf '| [US-TEST-001](x.md) | test | ✅ Done |\n' > .roll/backlog.md

  local started_at="2026-01-01T00:00:00+0000"
  GIT_COMMITTER_DATE="2026-01-02T00:00:00+0000" git commit \
    --date="2026-01-02T00:00:00+0000" --allow-empty -m "chore: nothing" -q

  run _loop_enforce_tcr "US-TEST-001" "$started_at"
  [ "$status" -eq 1 ]
  grep -q "📋 Todo" .roll/backlog.md
}

@test "_loop_enforce_tcr: writes ALERT when no tcr commits" {
  printf '| [US-TEST-001](x.md) | test | ✅ Done |\n' > .roll/backlog.md

  local started_at="2026-01-01T00:00:00+0000"
  _loop_enforce_tcr "US-TEST-001" "$started_at" || true

  [ -f "$_LOOP_ALERT" ]
  grep -q "US-TEST-001" "$_LOOP_ALERT"
}

@test "_loop_enforce_tcr: skips check when started_at is empty" {
  printf '| [US-TEST-001](x.md) | test | ✅ Done |\n' > .roll/backlog.md

  run _loop_enforce_tcr "US-TEST-001" ""
  [ "$status" -eq 0 ]
  grep -q "✅ Done" .roll/backlog.md
}

@test "roll loop enforce-tcr: CLI subcommand routes to _loop_enforce_tcr (empty started_at skips)" {
  printf '| [US-TEST-001](x.md) | test | ✅ Done |\n' > .roll/backlog.md

  # Empty started_at → _loop_enforce_tcr returns 0 immediately (no TCR check)
  run "$ROLL_BIN" loop enforce-tcr "US-TEST-001" ""
  [ "$status" -eq 0 ]
  grep -q "✅ Done" .roll/backlog.md
}

@test "roll loop enforce-tcr: CLI subcommand reverts story when no tcr commits" {
  printf '| [US-TEST-001](x.md) | test | ✅ Done |\n' > .roll/backlog.md

  local started_at="2026-01-01T00:00:00Z"
  GIT_COMMITTER_DATE="2026-01-02T00:00:00Z" git commit \
    --date="2026-01-02T00:00:00Z" --allow-empty -m "chore: nothing" -q

  run "$ROLL_BIN" loop enforce-tcr "US-TEST-001" "$started_at"
  [ "$status" -eq 1 ]
  grep -q "📋 Todo" .roll/backlog.md
}
