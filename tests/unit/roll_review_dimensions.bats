#!/usr/bin/env bats
# Tests for REFACTOR-022: simplify three-axis review integrated into
# roll-.review (inline checklist) and roll-build Phase 7 (parallel agents)

REVIEW_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-.review/SKILL.md"
BUILD_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"

# ── roll-.review: Reuse dimension ──────────────────────────────────────────

@test "roll-.review has Reuse as a review dimension" {
  grep -qiF 'Reuse' "$REVIEW_SKILL"
}

@test "roll-.review Reuse dimension mentions duplicate utility detection" {
  grep -qiE 'duplicate|既有.*utility|existing.*util' "$REVIEW_SKILL"
}

# ── roll-.review: Quality anti-patterns ────────────────────────────────────

@test "roll-.review Quality dimension mentions parameter sprawl" {
  grep -qiE 'parameter sprawl|参数.*sprawl|sprawl' "$REVIEW_SKILL"
}

@test "roll-.review Quality dimension mentions copy-paste near-duplicate" {
  grep -qiE 'copy.paste|copy-paste|近似重复|微变体' "$REVIEW_SKILL"
}

@test "roll-.review Quality dimension mentions nested conditionals" {
  grep -qiE 'nested conditional|嵌套条件|ternary chain' "$REVIEW_SKILL"
}

@test "roll-.review Quality dimension mentions stringly-typed" {
  grep -qiE 'stringly.typed|stringly-typed' "$REVIEW_SKILL"
}

# ── roll-.review: Efficiency anti-patterns ─────────────────────────────────

@test "roll-.review Efficiency dimension mentions N+1 pattern" {
  grep -qF 'N+1' "$REVIEW_SKILL"
}

@test "roll-.review Efficiency dimension mentions TOCTOU" {
  grep -qF 'TOCTOU' "$REVIEW_SKILL"
}

@test "roll-.review Efficiency dimension mentions missed concurrency" {
  grep -qiE 'missed concurrency|错失并发|independent.*parallel' "$REVIEW_SKILL"
}

# ── roll-.review: heading update ───────────────────────────────────────────

@test "roll-.review Review Dimensions heading reflects 7 dimensions" {
  grep -qiE '7|seven|6\+1' "$REVIEW_SKILL"
}

# ── roll-build Phase 7: three-agent parallel review ────────────────────────

@test "roll-build Phase 7 description says three-axis or three-agent" {
  grep -qiE 'three.axis|three.agent|三.*agent|三轴' "$BUILD_SKILL"
}

@test "roll-build Phase 7 mentions Reuse Review agent" {
  grep -qiE 'Reuse Review' "$BUILD_SKILL"
}

@test "roll-build Phase 7 mentions Quality Review agent" {
  grep -qiE 'Quality Review' "$BUILD_SKILL"
}

@test "roll-build Phase 7 mentions Efficiency Review agent" {
  grep -qiE 'Efficiency Review' "$BUILD_SKILL"
}

@test "roll-build Phase 7 uses main...HEAD diff range" {
  grep -qF 'main...HEAD' "$BUILD_SKILL"
}

@test "roll-build Phase 7 has fallback to roll-.review on agent failure" {
  grep -qiE 'fallback|roll-.review|退化' "$BUILD_SKILL"
}
