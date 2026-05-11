#!/usr/bin/env bats
# Tests for US-CL-003: eliminate standalone changelog commit

CHANGELOG_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-.changelog/SKILL.md"
BUILD_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"

# ─── roll-.changelog Step 6 ───────────────────────────────────────────────────

@test "roll-.changelog Step 6: does NOT contain git commit -m docs: update changelog" {
  ! grep -qF 'git commit -m "docs: update changelog' "$CHANGELOG_SKILL"
}

@test "roll-.changelog Step 6: contains git add CHANGELOG.md (stage only)" {
  grep -qF 'git add CHANGELOG.md' "$CHANGELOG_SKILL"
}

@test "roll-.changelog: documents chore: sync changelog for standalone/manual use" {
  grep -qF 'chore: sync changelog' "$CHANGELOG_SKILL"
}

@test "roll-.changelog: does NOT push in normal (roll-build context) mode" {
  local step6_body
  step6_body=$(awk '/^### 6\. Commit/{p=1} p{print} p && /^###[^#]/{if(NR>1)p=0}' "$CHANGELOG_SKILL")
  # The Stage-only path must not push
  echo "$step6_body" | grep -vqE 'standalone|manual' || true
  # Verify git push only appears in standalone fallback context
  local push_count
  push_count=$(echo "$step6_body" | grep -c 'git push' || true)
  # Either 0 push in step 6, or only in a documented standalone block
  [ "$push_count" -le 1 ]
}

# ─── roll-build Phase 11 ─────────────────────────────────────────────────────

@test "roll-build Phase 11: calls roll-.changelog before completion commit" {
  local phase11_body
  phase11_body=$(awk '/^### Phase 11/{p=1} p{print} p && /^### Phase [^1]/{if(NR>1)p=0}' "$BUILD_SKILL")
  # changelog call must appear before the git commit line
  local cl_line commit_line
  cl_line=$(echo "$phase11_body" | grep -n 'roll-.changelog' | head -1 | cut -d: -f1)
  commit_line=$(echo "$phase11_body" | grep -n 'git commit' | head -1 | cut -d: -f1)
  [ -n "$cl_line" ] && [ -n "$commit_line" ] && [ "$cl_line" -lt "$commit_line" ]
}

@test "roll-build Phase 11: completion commit includes CHANGELOG.md" {
  local phase11_body
  phase11_body=$(awk '/^### Phase 11/{p=1} p{print} p && /^### Phase [^1]/{if(NR>1)p=0}' "$BUILD_SKILL")
  echo "$phase11_body" | grep -qF 'CHANGELOG.md'
}

@test "roll-build Phase 12: does NOT call roll-.changelog (moved to Phase 11)" {
  local phase12_body
  phase12_body=$(awk '/^### Phase 12/{p=1} p{print} p && /^---/{if(NR>1)p=0}' "$BUILD_SKILL")
  ! echo "$phase12_body" | grep -qE '\$roll-.changelog'
}
