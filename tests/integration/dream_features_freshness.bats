#!/usr/bin/env bats
# US-DOC-009: roll-.dream Scan 5 Check D — features.md freshness check.
# Golden path: SKILL.md contains a complete, coherent Check D that describes
# matching BACKLOG Feature groups against docs/features.md and emitting REFACTOR entries.

load helpers

setup() {
  integration_setup 2>/dev/null || true
  DREAM_SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-.dream/SKILL.md"
}
teardown() { integration_teardown 2>/dev/null || true; }

@test "Scan 5 Check D section exists in dream SKILL.md" {
  grep -qiE "Check D|features\.md Feature Coverage" "${DREAM_SKILL}"
}

@test "Check D describes parsing BACKLOG for Feature groups with Done stories" {
  awk '/Check D/,/Check [E-Z]|### Scan 6/' "${DREAM_SKILL}" \
    | grep -qiE "Feature.*Done|Done.*Feature|feature.*group"
}

@test "Check D describes verifying Feature names appear in features.md" {
  awk '/Check D/,/Check [E-Z]|### Scan 6/' "${DREAM_SKILL}" \
    | grep -qiE "absent.*features\.md|features\.md.*absent|missing.*features\.md|features\.md.*missing"
}

@test "Check D has a dependency gate that skips when features.md absent" {
  awk '/Check D/,/Check [E-Z]|### Scan 6/' "${DREAM_SKILL}" \
    | grep -qiE "skip|not exist|absent"
}

@test "Check D REFACTOR message mentions the number of missing Feature groups" {
  awk '/Check D/,/Check [E-Z]|### Scan 6/' "${DREAM_SKILL}" \
    | grep -qiE "N.*功能区|功能区.*N|N个.*未收录|未收录.*N个"
}

@test "dream log doc-coverage section includes features.md coverage line" {
  grep -qiE "features\.md.*功能区覆盖|features\.md.*N.*M" "${DREAM_SKILL}"
}
