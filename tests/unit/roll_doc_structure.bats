#!/usr/bin/env bats
# E2E golden path for US-DOC-004: project root has no stray docs *.md files
# (post-Phase-1: docs/ removed, guide/ and site/ are root-level products,
# process artifacts live in .roll/)

REPO_ROOT="${BATS_TEST_DIRNAME}/../../"

@test "e2e: docs/ directory removed after Phase 1 migration" {
  # After Phase 1, docs/ should not exist at all (process moved to .roll/,
  # user-facing moved to guide/ + site/).
  [ ! -d "${REPO_ROOT}/docs" ] || {
    # Tolerate .DS_Store-only remnants on macOS dev hosts
    stray=$(find "${REPO_ROOT}/docs" -type f ! -name '.DS_Store' 2>/dev/null)
    [ -z "$stray" ]
  }
}

@test "e2e: guide/en/ has methodology, skills, plus original 4 guides" {
  [ -f "${REPO_ROOT}/guide/en/overview.md" ]
  [ -f "${REPO_ROOT}/guide/en/loop.md" ]
  [ -f "${REPO_ROOT}/guide/en/dream.md" ]
  [ -f "${REPO_ROOT}/guide/en/peer.md" ]
  [ -f "${REPO_ROOT}/guide/en/methodology.md" ]
  [ -f "${REPO_ROOT}/guide/en/skills.md" ]
}

@test "e2e: guide/zh/ has methodology, skills, plus original 4 guides" {
  [ -f "${REPO_ROOT}/guide/zh/overview.md" ]
  [ -f "${REPO_ROOT}/guide/zh/loop.md" ]
  [ -f "${REPO_ROOT}/guide/zh/dream.md" ]
  [ -f "${REPO_ROOT}/guide/zh/peer.md" ]
  [ -f "${REPO_ROOT}/guide/zh/methodology.md" ]
  [ -f "${REPO_ROOT}/guide/zh/skills.md" ]
}

@test "changelog SKILL.md Section 8.4 contains planning distinction rule" {
  local skill="${BATS_TEST_DIRNAME}/../../skills/roll-.changelog/SKILL.md"
  grep -q "规划中" "$skill"
}

# ─── REFACTOR-044: features.md format ──────────────────────────────────────

# .roll/ is gitignored — migrated to the private roll-meta repo — so a clean
# CI checkout has no repo .roll/. Skip when absent, the same dependency-gate
# pattern as roll-.dream Scan 5 Check D.

@test "features.md exists and is not empty" {
  [ -f "${REPO_ROOT}/.roll/features.md" ] || skip "no .roll/features.md (roll-meta not checked out)"
  [ -s "${REPO_ROOT}/.roll/features.md" ]
}

@test "features.md does not contain raw code fences" {
  [ -f "${REPO_ROOT}/.roll/features.md" ] || skip "no .roll/features.md (roll-meta not checked out)"
  # Content should be rendered markdown, not wrapped in code blocks.
  ! grep -q '^\x60\x60\x60' "${REPO_ROOT}/.roll/features.md"
}

@test "features.md has proper heading structure" {
  [ -f "${REPO_ROOT}/.roll/features.md" ] || skip "no .roll/features.md (roll-meta not checked out)"
  grep -q '^# Roll' "${REPO_ROOT}/.roll/features.md"
  grep -q '^## .*Core Highlights' "${REPO_ROOT}/.roll/features.md"
  grep -q '^## Features by Epic' "${REPO_ROOT}/.roll/features.md"
}

@test "features.md covers all BACKLOG Feature groups with Done stories" {
  local backlog="${REPO_ROOT}/.roll/backlog.md"
  local features="${REPO_ROOT}/.roll/features.md"
  [ -f "$backlog" ] && [ -f "$features" ] || skip "no .roll/ (roll-meta not checked out)"

  # Extract Feature names from BACKLOG that have Done stories
  local feature_names
  feature_names=$(awk '
    /^### Feature:/ {
      gsub(/^### Feature: */, "")
      feat = $0
      in_feat = 1
      has_done = 0
      next
    }
    in_feat && /^$/ { in_feat = 0; if (has_done) print feat }
    in_feat && /✅ Done/ { has_done = 1 }

    END { if (in_feat && has_done) print feat }
  ' "$backlog")

  [ -n "$feature_names" ]

  while IFS= read -r feat; do
    [ -n "$feat" ] || continue
    grep -qF "$feat" "$features" || {
      echo "MISSING Feature in features.md: $feat"
      false
    }
  done <<< "$feature_names"
}
