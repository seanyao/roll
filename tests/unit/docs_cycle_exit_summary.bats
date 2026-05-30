#!/usr/bin/env bats
# US-LOOP-042: user docs explain the .command cycle exit summary (US-LOOP-040 +
# US-LOOP-041 behaviour) — in both languages, EN/ZH on separate lines in the
# loop guide, plus a FAQ entry and a README index link.
#
# These assert the doc-refresh AC: both loop guides document the summary block,
# its five signals, NO_COLOR, the preserved `press enter to close` prompt, and
# the "summary unavailable" troubleshooting placeholder; the FAQ answers "what's
# that coloured block?"; the README index links the new section; and no doc
# describes the old "cycle ended. press enter to close" (no-summary) behaviour.

ROOT="${BATS_TEST_DIRNAME}/../.."
GUIDE_EN="${ROOT}/guide/en/loop.md"
GUIDE_ZH="${ROOT}/guide/zh/loop.md"
FAQ_EN="${ROOT}/guide/en/faq.md"
FAQ_ZH="${ROOT}/guide/zh/faq.md"

@test "EN loop documents the Cycle exit summary section" {
  grep -qF '## Cycle exit summary' "${GUIDE_EN}"
  grep -qF 'Summary ───' "${GUIDE_EN}"
}

@test "EN loop documents all five summary signals" {
  grep -qiF 'idle: no story picked' "${GUIDE_EN}"
  grep -qiE 'green.*red.*heal-attempting|heal-attempting' "${GUIDE_EN}"
  grep -qiF 'todo remaining' "${GUIDE_EN}"
  grep -qiE 'phase|phases' "${GUIDE_EN}"
  grep -qF '✗' "${GUIDE_EN}"
  grep -qF '⚠' "${GUIDE_EN}"
}

@test "EN loop documents NO_COLOR and the preserved press-enter prompt" {
  grep -qF 'NO_COLOR=1' "${GUIDE_EN}"
  grep -qF 'press enter to close' "${GUIDE_EN}"
}

@test "EN loop documents the summary-unavailable troubleshooting placeholder" {
  grep -qF 'summary unavailable' "${GUIDE_EN}"
  grep -qF 'cron-<slug>.log' "${GUIDE_EN}"
}

@test "ZH loop documents the Cycle exit summary section" {
  grep -qF 'Cycle 退出摘要' "${GUIDE_ZH}"
  grep -qF 'Summary ───' "${GUIDE_ZH}"
}

@test "ZH loop documents the five signals, NO_COLOR and the placeholder" {
  grep -qF 'idle: no story picked' "${GUIDE_ZH}"
  grep -qF 'NO_COLOR=1' "${GUIDE_ZH}"
  grep -qF 'press enter to close' "${GUIDE_ZH}"
  grep -qF 'summary unavailable' "${GUIDE_ZH}"
}

@test "ZH loop keeps EN and ZH on separate lines (bilingual convention)" {
  # The EN sentence and its ZH translation must not share a line. Grab the EN
  # marker line and assert it carries no multi-byte (CJK) byte — a pure-ASCII
  # line means the translation lives on its own separate line.
  run grep -F 'macOS `.command` window no longer leaves you' "${GUIDE_ZH}"
  [ "$status" -eq 0 ]
  # LC_ALL=C grep for any byte >= 0x80 (i.e. a UTF-8 multibyte lead) on that line.
  ! printf '%s' "$output" | LC_ALL=C grep -q '[^ -~	]'
}

@test "EN FAQ answers what the coloured .command summary block is" {
  grep -qF 'cycle exit summary' "${FAQ_EN}"
  grep -qF 'loop.md#cycle-exit-summary' "${FAQ_EN}"
}

@test "ZH FAQ answers what the coloured .command summary block is" {
  grep -qF '彩色摘要' "${FAQ_ZH}"
  grep -qF 'cycle-exit-summary' "${FAQ_ZH}"
}

@test "README indexes the cycle exit summary section (both READMEs)" {
  grep -qF 'guide/en/loop.md#cycle-exit-summary' "${ROOT}/README.md"
  grep -qF 'guide/en/loop.md#cycle-exit-summary' "${ROOT}/README_CN.md"
}

@test "no user doc keeps the old no-summary close behaviour" {
  # The pre-US-LOOP-040 window left only a bare 'cycle ended' close line with
  # no recap — that wording must not survive in any user-facing guide/README.
  ! grep -rniF 'cycle ended. press enter to close' \
      "${ROOT}/guide" "${ROOT}/README.md" "${ROOT}/README_CN.md"
}
