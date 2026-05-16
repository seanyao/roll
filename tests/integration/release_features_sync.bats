#!/usr/bin/env bats
# US-DOC-008: release.sh wires in a features.md rewrite step that runs the
# roll-.changelog skill (Section 8 mode). These are static-grep assertions —
# the actual AI call is integration-tested by manual release runs.

load helpers

setup() {
  integration_setup 2>/dev/null || true
  RELEASE_SH="${BATS_TEST_DIRNAME}/../../scripts/release.sh"
  SKILL_MD="${BATS_TEST_DIRNAME}/../../skills/roll-.changelog/SKILL.md"
  FEATURES_MD="${BATS_TEST_DIRNAME}/../../docs/features.md"
}
teardown() { integration_teardown 2>/dev/null || true; }

@test "release.sh defines _run_features_sync_skill" {
  grep -qF "_run_features_sync_skill()" "$RELEASE_SH"
}

@test "release.sh calls features sync after release notes step" {
  # the sync call must appear after the release_notes.txt block and before the commit block
  local notes_line; notes_line=$(grep -n "release_notes.txt generated" "$RELEASE_SH" | head -1 | cut -d: -f1)
  local sync_line; sync_line=$(grep -n "_run_features_sync_skill" "$RELEASE_SH" | tail -1 | cut -d: -f1)
  local commit_line; commit_line=$(grep -n '^git commit -m "\[release\]' "$RELEASE_SH" | head -1 | cut -d: -f1)
  [ -n "$notes_line" ] && [ -n "$sync_line" ] && [ -n "$commit_line" ]
  [ "$notes_line" -lt "$sync_line" ]
  [ "$sync_line" -lt "$commit_line" ]
}

@test "release.sh stages docs/features.md in the release commit" {
  # git add is a no-op for unchanged files, so staging is unconditional —
  # the safe-default cmp check (next test) prevents a bad AI write from
  # producing a "changed" file in the first place.
  grep -qE 'git add .* docs/features\.md' "$RELEASE_SH"
}

@test "release.sh feature sync is safe-by-default (no partial write)" {
  # uses cmp before mv so an empty / unchanged AI output doesn't truncate the file
  grep -qF "cmp -s docs/features.md" "$RELEASE_SH"
}

@test "roll-.changelog SKILL.md has Section 8 (features.md rewrite mode)" {
  grep -qE "^## 8\. features\.md" "$SKILL_MD"
}

@test "Section 8 documents the three-block structure" {
  # Section 8's output contract specifies Core Highlights + Features by Epic + 维护说明.
  # Skip lines before the Section 8 header so earlier sections can't satisfy the grep.
  awk '/^## 8\. features\.md/{found=1} found' "$SKILL_MD" > /tmp/section8.txt
  grep -qF "Core Highlights" /tmp/section8.txt
  grep -qF "Features by Epic" /tmp/section8.txt
  grep -qF "维护说明" /tmp/section8.txt
  rm -f /tmp/section8.txt
}

@test "bootstrap docs/features.md has the three required sections" {
  grep -qE "^## ✨ Core Highlights" "$FEATURES_MD"
  grep -qE "^## Features by Epic" "$FEATURES_MD"
  grep -qE "^## 维护说明" "$FEATURES_MD"
}

# ─── US-REL-002: AI call optimisation E2E golden path ────────────────────────

@test "release.sh golden path: _run_changelog_and_notes is called in main body" {
  # Verify the combined call is wired in the main flow (not just defined)
  local defn_line; defn_line=$(grep -n "_run_changelog_and_notes()" "$RELEASE_SH" | head -1 | cut -d: -f1)
  local call_line; call_line=$(grep -n "_run_changelog_and_notes " "$RELEASE_SH" | grep -v "^${defn_line}:" | head -1 | cut -d: -f1)
  [ -n "$call_line" ]
  [ "$call_line" -gt "$defn_line" ]
}

@test "release.sh golden path: _backlog_summary is called inside _run_features_sync_skill" {
  local start; start=$(grep -n "_run_features_sync_skill()" "$RELEASE_SH" | head -1 | cut -d: -f1)
  local end_line; end_line=$(awk "NR>$start && /^\}$/{print NR; exit}" "$RELEASE_SH")
  local body; body=$(sed -n "${start},${end_line}p" "$RELEASE_SH")
  echo "$body" | grep -q '_backlog_summary'
}

@test "release.sh golden path: total AI agent calls is 2 not 3" {
  local count; count=$(grep -c '_agent_argv ' "$RELEASE_SH" || true)
  [ "$count" -eq 2 ]
}

@test "bootstrap docs/features.md covers each BACKLOG ### Feature group" {
  # Each '### Feature: <name>' in BACKLOG should produce a presence in features.md
  # (link or plain mention by name). Allow either docs/features/<name>.md link
  # or plain-text occurrence of the feature name.
  local missing=0
  while IFS= read -r feat; do
    # feat is like "cli-simplification"; check link or plain mention
    if ! grep -qE "docs/features/${feat}\.md|${feat}" "$FEATURES_MD"; then
      echo "missing: $feat"
      missing=$((missing + 1))
    fi
  done < <(grep -oE '^### Feature: [a-z0-9-]+' "${BATS_TEST_DIRNAME}/../../BACKLOG.md" | sed 's|^### Feature: ||')
  [ "$missing" -eq 0 ]
}
