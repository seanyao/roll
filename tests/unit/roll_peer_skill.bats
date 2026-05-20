#!/usr/bin/env bats
# Tests for roll-peer SKILL.md content invariants — guards the Independent
# Judgment Rule introduced after a real-world incident where peer review on
# PR #104 (FIX-071) was opened with the reviewer's full root-cause analysis,
# proposed diff, and three leading questions all prefilled. The peer (kimi)
# AGREE'd inside that framing and the verdict carried no real signal.
#
# These contract tests pin the skill text so the rule cannot silently
# regress.

SKILL_FILE="${BATS_TEST_DIRNAME}/../../skills/roll-peer/SKILL.md"

@test "roll-peer SKILL.md: declares an Independent Judgment Rule section" {
  grep -qE '^### Independent Judgment Rule' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: explains why endorsement-seeking peer review is broken" {
  grep -qE 'second, independent|endorsement|signal' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: round=1 message MUST NOT include reviewer's root-cause analysis" {
  grep -qE 'root-cause analysis' "$SKILL_FILE"
  grep -qE 'must NOT include|do NOT prefill|MUST NOT include' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: round=1 message MUST NOT include reviewer's fix diff" {
  grep -qE 'proposed fix|fix, patch, or diff' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: round=1 message MUST NOT include leading questions" {
  grep -qE 'leading question' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: round=1 message MUST NOT prefill specific line numbers / function names" {
  grep -qE 'line numbers, function names' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: spells out what round=1 SHOULD include (symptoms, entry points, open invitation)" {
  grep -qE 'should include' "$SKILL_FILE"
  grep -qE 'Symptoms|verbatim' "$SKILL_FILE"
  grep -qE 'entry points' "$SKILL_FILE"
  grep -qE 'open invitation|independently identify' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: prescribes comparison of reviewer's own conclusion vs peer's" {
  grep -qE 'compare|comparison' "$SKILL_FILE"
  grep -qE "Reviewer's own conclusion" "$SKILL_FILE"
  # The four-row decision table must spell out at minimum these branches
  grep -qE 'Same root cause \+ same fix direction' "$SKILL_FILE"
  grep -qE 'Different root cause' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: includes a bad example (endorsement-seeking) and a good example (independent analysis)" {
  grep -qE 'Example \(bad' "$SKILL_FILE"
  grep -qE 'Example \(good' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: Handoff Card rules forbid prefilling conclusions" {
  # The handoff-card rules block must explicitly point at Independent Judgment Rule
  grep -qE 'handoff card is for context, not conclusions|Independent Judgment Rule' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: Inline Display rules require outgoing message to obey the new rule" {
  grep -qE 'round=1 message must follow' "$SKILL_FILE"
}

@test "roll-peer SKILL.md: Inline Display rules require comparison block after peer reply" {
  grep -qE "comparison is what determines the next round's action|peer's root cause and fix direction match the reviewer's own" "$SKILL_FILE"
}
