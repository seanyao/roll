#!/usr/bin/env bats
# US-AGENT-007: build/fix SKILLs publish a Pre-flight self-check protocol
# so agents can self-evaluate (verdict: ok | too_big) before doing real work.

BUILD_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"
FIX_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-fix/SKILL.md"

@test "roll-build SKILL: has Pre-flight self-check section" {
  grep -qE 'Pre-flight self-check|预检自评|self-check' "$BUILD_SKILL"
}

@test "roll-fix SKILL: has Pre-flight self-check section" {
  grep -qE 'Pre-flight self-check|预检自评|self-check' "$FIX_SKILL"
}

@test "roll-build SKILL: verdict shape documented (ok / too_big)" {
  grep -qE 'verdict.*ok.*too_big|verdict.*too_big.*ok|ok\|too_big|"ok"|"too_big"' "$BUILD_SKILL"
}

@test "roll-fix SKILL: verdict shape documented (ok / too_big)" {
  grep -qE 'verdict.*ok.*too_big|verdict.*too_big.*ok|ok\|too_big|"ok"|"too_big"' "$FIX_SKILL"
}

@test "roll-build SKILL: pre-flight reads Agent profile (est_min / risk_zone)" {
  grep -qF 'est_min' "$BUILD_SKILL"
  grep -qF 'risk_zone' "$BUILD_SKILL"
}

@test "roll-fix SKILL: pre-flight reads Agent profile (est_min / risk_zone)" {
  grep -qF 'est_min' "$FIX_SKILL"
  grep -qF 'risk_zone' "$FIX_SKILL"
}

@test "roll-build SKILL: documents too_big triggers self-downgrade path" {
  grep -qE 'too_big.*self-downgrade|self-downgrade.*too_big|too_big.*再拆|再拆.*too_big' "$BUILD_SKILL"
}

@test "roll-fix SKILL: documents too_big triggers self-downgrade path" {
  grep -qE 'too_big.*self-downgrade|self-downgrade.*too_big|too_big.*再拆|再拆.*too_big' "$FIX_SKILL"
}

@test "roll-build SKILL: documents threshold + chain_depth=0 condition" {
  # When historical hit rate < prefer_threshold AND chain_depth == 0
  grep -qE 'chain_depth.*0|prefer_threshold' "$BUILD_SKILL"
}

@test "roll-fix SKILL: documents threshold + chain_depth=0 condition" {
  grep -qE 'chain_depth.*0|prefer_threshold' "$FIX_SKILL"
}
