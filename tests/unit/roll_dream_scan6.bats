#!/usr/bin/env bats
# Tests for roll-.dream Scan 6 additions (US-AUTO-028)

SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-.dream/SKILL.md"

@test "roll-.dream SKILL.md: Scan 6 section exists" {
  grep -qE '^### Scan 6' "$SKILL"
}

@test "roll-.dream SKILL.md: Scan 6 check A — stale docs (30-day threshold)" {
  grep -qiE 'Scan 6|stale' "$SKILL"
  grep -qE '30' "$SKILL"
}

@test "roll-.dream SKILL.md: Scan 6 check B — undocumented ENV vars (>=5 occurrences)" {
  grep -qE 'process\\\\?\.env|os\.getenv|ENV\[' "$SKILL"
  grep -qE '≥5|>=5' "$SKILL"
}

@test "roll-.dream SKILL.md: Scan 6 check C — existence drift (module dir with no domain doc)" {
  grep -qiE 'existence drift|docs/domain' "$SKILL"
}

@test "roll-.dream SKILL.md: Scan 6 no double-flag with Scan 2 documented" {
  grep -qiE 'double.flag|double flag|Scan 2.*Scan 6|Scan 6.*Scan 2' "$SKILL"
}

@test "roll-.dream SKILL.md: Scan 6 REFACTOR entries reference roll-doc as execution hint" {
  grep -qF 'roll-doc' "$SKILL"
}

@test "roll-.dream SKILL.md: Scan 6 skipped when roll-doc not deployed" {
  grep -qiE 'skip|US-SKILL-008|roll-doc.*not.*deploy|not.*deploy.*roll-doc' "$SKILL"
}

@test "roll-.dream SKILL.md: dream log template includes doc freshness section" {
  grep -qF '文档新鲜度' "$SKILL"
}

@test "roll-.dream SKILL.md: dream log header summary updated to include doc freshness scan" {
  grep -qE '文档(新鲜度|覆盖度).*文档(新鲜度|覆盖度)' "$SKILL" || \
  grep -qE '文档新鲜度' "$SKILL"
}

@test "roll-.dream SKILL.md: description frontmatter updated to mention doc freshness" {
  grep -qiE 'doc.freshness|文档新鲜度|staleness' "$SKILL"
}

@test "roll-.dream Scan 6: synced to installed skill at ~/.roll" {
  grep -qE 'Scan 6' "${HOME}/.roll/skills/roll-.dream/SKILL.md"
}
