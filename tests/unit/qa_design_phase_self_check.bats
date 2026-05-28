#!/usr/bin/env bats
# US-QA-011: AGENTS.md + build/fix skills publish a design-phase self-check
# for the two new test-quality categories.

AGENTS_MD="${BATS_TEST_DIRNAME}/../../AGENTS.md"
BUILD_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-build/SKILL.md"
FIX_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-fix/SKILL.md"

@test "AGENTS.md has test-quality design self-check tied to US-QA-011" {
  grep -qE 'US-QA-011|Test-quality design self-check' "$AGENTS_MD"
}

@test "AGENTS.md self-check names rubric ❼ AND ❽" {
  grep -qF '❼' "$AGENTS_MD"
  grep -qF '❽' "$AGENTS_MD"
}

@test "AGENTS.md self-check warns against inlining external tools" {
  grep -qE 'sed.*awk.*grep|inline|external-tool|inline external' "$AGENTS_MD"
}

@test "AGENTS.md self-check warns against touching paths outside the repo" {
  grep -qE 'outside this repo|~/\.codex|~/\.kimi|~/\.roll|BATS_TMPDIR' "$AGENTS_MD"
}

@test "AGENTS.md links to quality-rubric.md" {
  grep -qE 'quality-rubric|test-quality' "$AGENTS_MD"
}

@test "roll-build SKILL Step 2 has Test-quality self-check" {
  grep -qE 'Test-quality self-check|US-QA-011' "$BUILD_SKILL"
}

@test "roll-build SKILL self-check names rubric ❼ and ❽" {
  awk '/^### Step 2:/{flag=1;next}/^### Step 3:/{flag=0}flag' "$BUILD_SKILL" > /tmp/build-step2.txt  # test-quality:allow (doc-section extraction, not production parsing)
  grep -qF '❼' /tmp/build-step2.txt
  grep -qF '❽' /tmp/build-step2.txt
  rm -f /tmp/build-step2.txt
}

@test "roll-fix SKILL Step 2 (Define verification) has Test-quality self-check" {
  grep -qE 'Test-quality self-check|US-QA-011' "$FIX_SKILL"
}

@test "roll-fix SKILL self-check names rubric ❼ and ❽" {
  awk '/^### 2\. Define verification/{flag=1;next}/^### 3\. Test/{flag=0}flag' "$FIX_SKILL" > /tmp/fix-step2.txt  # test-quality:allow (doc-section extraction, not production parsing)
  grep -qF '❼' /tmp/fix-step2.txt
  grep -qF '❽' /tmp/fix-step2.txt
  rm -f /tmp/fix-step2.txt
}
