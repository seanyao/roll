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

@test "e2e: .roll/verification/ has loop-autorun-verification.md" {
  [ -f "${REPO_ROOT}/.roll/verification/loop-autorun-verification.md" ]
}

# US-DOC-010: features.md catalog completeness vs BACKLOG is a release-time check only.
# If this assertion is present in integration CI, any loop PR adding a new Feature group
# will fail CI (features.md is only rewritten at release time by release.sh).
@test "integration CI does not check features.md catalog completeness against BACKLOG" {
  local ci_test="${BATS_TEST_DIRNAME}/../integration/release_features_sync.bats"
  ! grep -qF "mentions every BACKLOG" "$ci_test"
}

# US-DOC-011: features.md distinguishes planning-stage features (all-Todo) from shipped ones.
# Data-driven: scan BACKLOG for any Feature whose stories are entirely 📋 Todo / 🔨 In Progress,
# and require features.md to mark each such Feature with 规划中. When no Feature is all-Todo
# (i.e. every Feature has shipped at least one story), the test passes trivially.
@test "features.md marks each all-Todo Feature with planning marker" {
  local backlog="${BATS_TEST_DIRNAME}/../../.roll/backlog.md"
  local features="${REPO_ROOT}/.roll/features.md"
  local missing=""
  while IFS= read -r line; do
    [ -n "$line" ] && ! grep -i "${line}" "$features" | grep -q "规划中" && missing="${missing}\n${line}"
  done < <(awk '
    /^### Feature:/ {
      if (name != "" && todo > 0 && done == 0) print name
      name = $0; sub(/^### Feature: */, "", name); todo = 0; done = 0; next
    }
    /✅ Done/ { done++ }
    /📋 Todo|🔨 In Progress/ { todo++ }
    END { if (name != "" && todo > 0 && done == 0) print name }
  ' "$backlog")
  [ -z "$missing" ] || { echo -e "All-Todo Features missing 规划中 marker in features.md:${missing}"; false; }
}

@test "changelog SKILL.md Section 8.4 contains planning distinction rule" {
  local skill="${BATS_TEST_DIRNAME}/../../skills/roll-.changelog/SKILL.md"
  grep -q "规划中" "$skill"
}
