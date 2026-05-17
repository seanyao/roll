#!/usr/bin/env bats
# US-REL-002: release.sh AI call optimisation — changelog+notes merged, section-scoped prompts

RELEASE_SH="${BATS_TEST_DIRNAME}/../../scripts/release.sh"
SKILL_MD="${BATS_TEST_DIRNAME}/../../skills/roll-.changelog/SKILL.md"

# ─── Merged changelog + release-notes call ───────────────────────────────────

@test "release.sh defines _run_changelog_and_notes (merged function)" {
  grep -qF "_run_changelog_and_notes()" "$RELEASE_SH"
}

@test "release.sh does NOT define old _run_changelog_skill separately" {
  ! grep -qF "_run_changelog_skill()" "$RELEASE_SH"
}

@test "release.sh does NOT define old _run_release_notes_skill separately" {
  ! grep -qF "_run_release_notes_skill()" "$RELEASE_SH"
}

@test "_run_changelog_and_notes strips section 8 from skill content (sends only sections 1-7)" {
  # Must use awk (or similar) to exclude the '## 8.' features.md section
  grep -qE 'awk.*8.*features|## 8\.' "$RELEASE_SH"
}

@test "release.sh captures _run_changelog_and_notes stdout as release_notes.txt" {
  # The combined call output must be redirected to release_notes.txt
  grep -qE '_run_changelog_and_notes.*>.*release_notes\.txt|> release_notes\.txt.*_run_changelog_and_notes' "$RELEASE_SH"
}

# ─── features.md slim prompt ─────────────────────────────────────────────────

@test "release.sh defines _backlog_summary helper" {
  grep -qF "_backlog_summary()" "$RELEASE_SH"
}

@test "_run_features_sync_skill uses section 8 only (not full skill content)" {
  # Must extract section 8 from skill via awk or similar
  grep -qE 'awk.*## 8|section.*8' "$RELEASE_SH"
}

@test "_run_features_sync_skill does NOT inline full BACKLOG.md content" {
  # The old approach was: backlog_content=$(<BACKLOG.md)
  # New approach uses _backlog_summary instead
  ! grep -qF 'backlog_content=$(<BACKLOG.md)' "$RELEASE_SH"
}

@test "_run_features_sync_skill calls _backlog_summary" {
  # Features sync prompt must use the compact summary helper
  local start; start=$(grep -n "_run_features_sync_skill()" "$RELEASE_SH" | head -1 | cut -d: -f1)
  local end_line; end_line=$(awk "NR>$start && /^\}$/{print NR; exit}" "$RELEASE_SH")
  local body; body=$(sed -n "${start},${end_line}p" "$RELEASE_SH")
  echo "$body" | grep -q '_backlog_summary'
}

# ─── AC: AI calls reduced from 3 to 2 ───────────────────────────────────────

@test "release.sh has exactly 2 _agent_argv call sites (changelog+notes and features)" {
  local count; count=$(grep -c '_agent_argv ' "$RELEASE_SH" || true)
  [ "$count" -eq 2 ]
}

# ─── Regression: existing structure preserved ────────────────────────────────

@test "release.sh still defines _run_features_sync_skill" {
  grep -qF "_run_features_sync_skill()" "$RELEASE_SH"
}

@test "release.sh still stages docs/features.md in the release commit" {
  grep -qE 'git add .* docs/features\.md' "$RELEASE_SH"
}

@test "release.sh still has safe-by-default cmp check for features.md" {
  grep -qF "cmp -s docs/features.md" "$RELEASE_SH"
}

# ─── REFACTOR-021: release notes extracted from CHANGELOG.md, not AI stdout ──

@test "_run_changelog_and_notes discards agent stdout and extracts notes from CHANGELOG.md" {
  # Agent's raw stdout must be suppressed; release notes come from CHANGELOG.md via awk
  local start; start=$(grep -n "_run_changelog_and_notes()" "$RELEASE_SH" | head -1 | cut -d: -f1)
  local end_line; end_line=$(awk "NR>$start && /^\}$/{print NR; exit}" "$RELEASE_SH")
  local body; body=$(sed -n "${start},${end_line}p" "$RELEASE_SH")
  echo "$body" | grep -q '>/dev/null'
  echo "$body" | grep -qE 'awk.*CHANGELOG|CHANGELOG.*awk'
}
