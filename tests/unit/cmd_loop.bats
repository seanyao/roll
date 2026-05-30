#!/usr/bin/env bats
# US-OBS-010: _project_slug remote-based slug derivation
#
# Verifies that _project_slug uses git remote origin URL (normalized) for
# stable cross-machine project identity, falling back to path-based slug
# when no remotes are available.

load helpers

setup()    { unset ROLL_MAIN_SLUG; unit_setup; }
teardown() {
  unset ROLL_MAIN_SLUG
  unset ROLL_CONFIG
  unit_teardown
}

# ─── Remote-based slug ─────────────────────────────────────────────────────

@test "_project_slug: uses remote origin URL (https) for hash" {
  local repo="${TEST_TMP}/obs010-https"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://github.com/user/my-project.git"

  local s
  s=$(_project_slug "$repo")

  # should derive from normalized URL base "my-project"
  [[ "$s" =~ ^my-project-[a-f0-9]{6}$ ]]
}

@test "_project_slug: strips .git suffix from origin URL" {
  local repo="${TEST_TMP}/obs010-stripgit"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://github.com/org/repo.git"

  local s
  s=$(_project_slug "$repo")

  [[ "$s" =~ ^repo-[a-f0-9]{6}$ ]]
}

@test "_project_slug: normalizes git@ format to https:// for hash" {
  local repo="${TEST_TMP}/obs010-ssh"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "git@github.com:user/my-lib.git"

  local s
  s=$(_project_slug "$repo")

  # After normalization: https://github.com/user/my-lib → base "my-lib"
  [[ "$s" =~ ^my-lib-[a-f0-9]{6}$ ]]
}

@test "_project_slug: lowercase normalizes origin URL" {
  local repo="${TEST_TMP}/obs010-case"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://GitHub.COM/User/My-Project"

  local s
  s=$(_project_slug "$repo")

  # Lowercase normalized: base "my-project"
  [[ "$s" =~ ^my-project-[a-f0-9]{6}$ ]]
}

# ─── Fallback: no origin → first available remote ──────────────────────────

@test "_project_slug: uses first available remote when origin is missing" {
  local repo="${TEST_TMP}/obs010-noorigin"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add upstream "https://github.com/upstream/fork.git"

  local s
  s=$(_project_slug "$repo")
  [[ "$s" =~ ^fork-[a-f0-9]{6}$ ]]
}

# ─── Fallback: no remotes → path-based slug ────────────────────────────────

@test "_project_slug: falls back to path-based when no git remotes exist" {
  local repo="${TEST_TMP}/obs010-noremote"
  mkdir -p "$repo"
  git -C "$repo" init

  local s
  s=$(_project_slug "$repo")

  # Should use path-based hash (same as pre-OBS-010 behavior)
  [[ "$s" =~ ^obs010-noremote-[a-f0-9]{6}$ ]]
}

@test "_project_slug: falls back to path-based when not a git repo" {
  local dir="${TEST_TMP}/obs010-nogit"
  mkdir -p "$dir"

  local s
  s=$(_project_slug "$dir")
  [[ "$s" =~ ^obs010-nogit-[a-f0-9]{6}$ ]]
}

# ─── WARNING: records_remote configured but no remote URL ──────────────────

@test "_project_slug: emits WARNING when roll_records_remote set but no remote url" {
  local repo="${TEST_TMP}/obs010-warning"
  mkdir -p "$repo"
  git -C "$repo" init

  # Simulate roll_records_remote configured
  local orig_config="${ROLL_CONFIG:-}"
  ROLL_CONFIG="${TEST_TMP}/obs010-config.yaml"
  echo "roll_records_remote: git@github.com:user/records.git" > "$ROLL_CONFIG"

  run _project_slug "$repo"
  [ "$status" -eq 0 ]

  [[ "$output" =~ "WARNING" ]] || [[ "$output" =~ "slug will fall back" ]]

  # Restore
  if [[ -n "$orig_config" ]]; then
    ROLL_CONFIG="$orig_config"
  else
    unset ROLL_CONFIG
  fi
}

# ─── Regression: ROLL_MAIN_SLUG still wins ─────────────────────────────────

@test "_project_slug: ROLL_MAIN_SLUG overrides remote-based slug" {
  local repo="${TEST_TMP}/obs010-main-slug"
  mkdir -p "$repo"
  git -C "$repo" init
  git -C "$repo" remote add origin "https://github.com/user/some-repo.git"

  export ROLL_MAIN_SLUG="override-abc123"
  local s
  s=$(_project_slug "$repo")
  [ "$s" = "override-abc123" ]
  unset ROLL_MAIN_SLUG
}

# ─── Cross-machine: same origin → same slug ────────────────────────────────

@test "_project_slug: same remote URL in different dirs produces same slug" {
  local repo_a="${TEST_TMP}/obs010-cross-a"
  local repo_b="${TEST_TMP}/obs010-cross-b"
  mkdir -p "$repo_a" "$repo_b"
  git -C "$repo_a" init
  git -C "$repo_b" init
  git -C "$repo_a" remote add origin "https://github.com/team/shared-lib.git"
  git -C "$repo_b" remote add origin "https://github.com/team/shared-lib.git"

  local sa sb
  sa=$(_project_slug "$repo_a")
  sb=$(_project_slug "$repo_b")
  [ "$sa" = "$sb" ]
}

@test "_project_slug: different remote URLs produce different slugs" {
  local repo_a="${TEST_TMP}/obs010-diff-a"
  local repo_b="${TEST_TMP}/obs010-diff-b"
  mkdir -p "$repo_a" "$repo_b"
  git -C "$repo_a" init
  git -C "$repo_b" init
  git -C "$repo_a" remote add origin "https://github.com/team/project-one.git"
  git -C "$repo_b" remote add origin "https://github.com/team/project-two.git"

  local sa sb
  sa=$(_project_slug "$repo_a")
  sb=$(_project_slug "$repo_b")
  [ "$sa" != "$sb" ]
}

# ─── Worktree: slug consistent from within git worktree ────────────────────

@test "_project_slug: worktree slave produces same slug as main tree (remote-based)" {
  local main="${TEST_TMP}/obs010-main-tree"
  mkdir -p "$main"
  git -C "$main" init
  git -C "$main" remote add origin "https://github.com/team/worktree-repo.git"
  # CI runners do not have a global git identity — required for commit.
  git -C "$main" config user.email "test@example.com"
  git -C "$main" config user.name "Test"
  # Create an initial commit so worktree add works
  git -C "$main" commit --allow-empty -m "init"

  local wt="${TEST_TMP}/obs010-worktree"
  git -C "$main" worktree add "$wt" -b obs010-wt-branch

  local sm sw
  sm=$(_project_slug "$main")
  sw=$(_project_slug "$wt")
  [ "$sm" = "$sw" ]

  # Cleanup worktree
  git -C "$main" worktree remove "$wt" --force 2>/dev/null || true
  git -C "$main" branch -D obs010-wt-branch 2>/dev/null || true
}

# ─── Migration: _slug_migrate_to_remote ────────────────────────────────────

@test "_slug_migrate_to_remote: function exists" {
  declare -f _slug_migrate_to_remote >/dev/null
}

@test "_slug_migrate_to_remote: no-ops when old and new slugs are identical" {
  local proj="${TEST_TMP}/obs010-mig-same"
  mkdir -p "$proj"
  git -C "$proj" init
  # No remote → path-based slug. Both old (path) and new (path) are same.
  local loop_dir="${TEST_TMP}/loop"
  mkdir -p "$loop_dir"

  # Create a dummy old events file (same slug)
  local slug; slug=$(_project_slug "$proj")
  echo '{"ts":"2026-01-01T00:00:00Z","label":"test-1"}' > "${loop_dir}/events-${slug}.ndjson"

  run _slug_migrate_to_remote "$proj" "$loop_dir"
  [ "$status" -eq 0 ]
  # File untouched (no .bak created)
  [ -f "${loop_dir}/events-${slug}.ndjson" ]
  [ ! -f "${loop_dir}/events-${slug}.ndjson.bak" ]
}

@test "_slug_migrate_to_remote: migrates events from old path slug to new remote slug" {
  local proj="${TEST_TMP}/obs010-mig-events"
  mkdir -p "$proj"
  git -C "$proj" init
  git -C "$proj" remote add origin "https://github.com/org/mig-repo.git"

  local loop_dir="${TEST_TMP}/loop"
  mkdir -p "$loop_dir"

  local new_slug; new_slug=$(_project_slug "$proj")
  local old_slug; old_slug=$(_project_slug_path_based "$proj")
  echo "old=$old_slug new=$new_slug"

  # Old slug and new slug should differ (path-based vs remote-based)
  [ "$old_slug" != "$new_slug" ]

  # Create old events file
  echo '{"ts":"2026-01-01T00:00:00Z","label":"cycle-1"}' > "${loop_dir}/events-${old_slug}.ndjson"
  echo '{"ts":"2026-01-02T00:00:00Z","label":"cycle-2"}' >> "${loop_dir}/events-${old_slug}.ndjson"

  run _slug_migrate_to_remote "$proj" "$loop_dir"
  [ "$status" -eq 0 ]

  # New file should exist with migrated events
  [ -f "${loop_dir}/events-${new_slug}.ndjson" ]

  # Old file backed up as .bak, original removed
  [ -f "${loop_dir}/events-${old_slug}.ndjson.bak" ]
  [ ! -f "${loop_dir}/events-${old_slug}.ndjson" ]
}

@test "_slug_migrate_to_remote: deduplicates events by label (run_id)" {
  local proj="${TEST_TMP}/obs010-mig-dedup"
  mkdir -p "$proj"
  git -C "$proj" init
  git -C "$proj" remote add origin "https://github.com/org/dedup-repo.git"

  local loop_dir="${TEST_TMP}/loop"
  mkdir -p "$loop_dir"

  local new_slug; new_slug=$(_project_slug "$proj")
  local old_slug; old_slug=$(_project_slug_path_based "$proj")

  # Create new events file with cycle-1
  echo '{"ts":"2026-01-01T00:00:00Z","label":"cycle-1","msg":"new"}' > "${loop_dir}/events-${new_slug}.ndjson"

  # Create old events file with cycle-1 (dup) and cycle-2 (new)
  echo '{"ts":"2026-01-01T00:00:00Z","label":"cycle-1","msg":"old"}' > "${loop_dir}/events-${old_slug}.ndjson"
  echo '{"ts":"2026-01-02T00:00:00Z","label":"cycle-2","msg":"old"}' >> "${loop_dir}/events-${old_slug}.ndjson"

  run _slug_migrate_to_remote "$proj" "$loop_dir"
  [ "$status" -eq 0 ]

  # Should have 2 events (cycle-1 from new file, cycle-2 from old)
  local count
  count=$(grep -c . "${loop_dir}/events-${new_slug}.ndjson" 2>/dev/null || echo 0)
  [ "$count" -eq 2 ]

  # cycle-1 should be the "new" version (existing record wins)
  grep -q '"msg":"new"' "${loop_dir}/events-${new_slug}.ndjson"
}

@test "_slug_migrate_to_remote: idempotent — second run no-ops" {
  local proj="${TEST_TMP}/obs010-mig-idem"
  mkdir -p "$proj"
  git -C "$proj" init
  git -C "$proj" remote add origin "https://github.com/org/idem-repo.git"

  local loop_dir="${TEST_TMP}/loop"
  mkdir -p "$loop_dir"

  local old_slug; old_slug=$(_project_slug_path_based "$proj")

  echo '{"ts":"2026-01-01T00:00:00Z","label":"cycle-1"}' > "${loop_dir}/events-${old_slug}.ndjson"

  # First migration
  _slug_migrate_to_remote "$proj" "$loop_dir"

  # Second run: old events file is gone (moved to .bak), so nothing to do
  run _slug_migrate_to_remote "$proj" "$loop_dir"
  [ "$status" -eq 0 ]
}

# ─── US-OBS-014: _loop_push_status_snapshot ────────────────────────────────
# Each loop cycle end fires a best-effort background push to roll-meta. The
# helper is sourced from bin/roll (the inner runner calls it after cycle_end),
# so we can exercise it directly. A mock push script writes a flag file so we
# can assert it was actually invoked with the roll_meta_dir argument.

# Build a fake roll-meta checkout whose ops/push-loop-status.sh records its
# first arg into "$1/invoked.flag". Echoes the meta dir path on stdout.
_obs014_make_meta() {
  local meta="$1"
  mkdir -p "${meta}/ops"
  cat > "${meta}/ops/push-loop-status.sh" <<'MOCK'
#!/bin/bash
printf '%s' "$1" > "$(dirname "$0")/../invoked.flag"
MOCK
  chmod +x "${meta}/ops/push-loop-status.sh"
}

# Poll for the flag file (push runs in the background); bounded to ~5s.
_obs014_wait_flag() {
  local flag="$1" n=0
  while [ "$n" -lt 50 ]; do
    [ -f "$flag" ] && return 0
    sleep 0.1
    n=$((n + 1))
  done
  return 1
}

@test "_loop_push_status_snapshot: configured + script exists → invokes push in background" {
  local meta="${TEST_TMP}/obs014-meta"
  _obs014_make_meta "$meta"

  ROLL_CONFIG="${TEST_TMP}/obs014-config.yaml"
  echo "roll_meta_dir: ${meta}" > "$ROLL_CONFIG"

  _loop_push_status_snapshot

  _obs014_wait_flag "${meta}/invoked.flag"
  [ -f "${meta}/invoked.flag" ]
  # invoked with the meta dir as its first argument
  [ "$(cat "${meta}/invoked.flag")" = "$meta" ]
}

@test "_loop_push_status_snapshot: roll_meta_dir unset → no call, no output, no side effect" {
  ROLL_CONFIG="${TEST_TMP}/obs014-empty-config.yaml"
  echo "default_language: zh" > "$ROLL_CONFIG"

  run _loop_push_status_snapshot
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_loop_push_status_snapshot: configured but path missing → WARNING logged, no call" {
  local meta="${TEST_TMP}/obs014-nonexistent"

  ROLL_CONFIG="${TEST_TMP}/obs014-missing-config.yaml"
  echo "roll_meta_dir: ${meta}" > "$ROLL_CONFIG"

  run _loop_push_status_snapshot
  [ "$status" -eq 0 ]
  [[ "$output" =~ "WARNING" ]]
  [[ "$output" =~ "does not exist" ]]
  # nothing was created
  [ ! -e "${meta}/invoked.flag" ]
}

@test "_loop_push_status_snapshot: idle cycle path wires the push call" {
  # The idle branch must fire the same push as the done branch (heartbeat:
  # lets remote-watch tell "online but no work" from "offline"). The inner
  # runner is a generated script, so assert the wiring lives in the idle
  # branch of bin/roll — directly after the terminal idle cycle_end emit.
  run grep -n "_loop_push_status_snapshot" "$ROLL_BIN"
  [ "$status" -eq 0 ]
  # idle branch: cycle_end "idle" is immediately followed by the push call
  run awk '/cycle_end .*"idle"/{f=1} f && /_loop_push_status_snapshot/{print "FOUND"; exit}' "$ROLL_BIN"
  [[ "$output" =~ "FOUND" ]]
}
