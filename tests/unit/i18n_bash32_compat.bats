#!/usr/bin/env bats
# Regression net for the bash 3.2 release blocker.
#
# PR #211 replaced an awk fork with ${var^^} (bash 4+ syntax). macOS still
# ships bash 3.2.57, so the change made `bin/roll` unrunnable locally and
# tipped 125+ tests into setup failure. CI runs on Ubuntu (bash 5) and missed
# it. These tests source lib/i18n.sh in isolation and exercise every code
# path that uppercases — any future bash-4-only operator drops one of these.
#
# PR #213 replaced ${lang^^} with $(_i18n_upper) to restore bash 3.2 compat,
# but re-introduced a subshell fork per catalog entry (~2s per source of
# bin/roll). PR #215+ inlined the case statement directly in _i18n_set and
# msg_lang — zero subshell forks, bash 3.2-compatible. _i18n_upper is gone.

LIB="${BATS_TEST_DIRNAME}/../../lib"

setup() {
  # Source in a subshell-free way so the helper functions are visible to @test.
  # shellcheck disable=SC1090,SC1091
  source "${LIB}/i18n.sh"
}

@test "_i18n_set EN common path populates MSG_EN_<key> without bash 4+ syntax" {
  _i18n_set en greeting "Hello, %s!"
  [ "$MSG_EN_greeting" = "Hello, %s!" ]
  _i18n_set EN greeting2 "Hi"
  [ "$MSG_EN_greeting2" = "Hi" ]
}

@test "_i18n_set ZH common path populates MSG_ZH_<key> with CJK payload" {
  _i18n_set zh greeting "你好，%s！"
  [ "$MSG_ZH_greeting" = "你好，%s！" ]
  _i18n_set ZH greeting2 "嗨"
  [ "$MSG_ZH_greeting2" = "嗨" ]
}

@test "_i18n_set unknown locale falls back to tr (still uppercase, no bash 4+)" {
  # Exercises the * arm of the inline case — must not use ${var^^}
  _i18n_set fr greeting "Bonjour, %s!"
  [ "$MSG_FR_greeting" = "Bonjour, %s!" ]
  _i18n_set ja greeting "こんにちは"
  [ "$MSG_JA_greeting" = "こんにちは" ]
}

@test "msg_lang resolves the registered template" {
  _i18n_set en colon_test "key: %s"
  _i18n_set zh colon_test "键：%s"
  [ "$(msg_lang en colon_test world)" = "key: world" ]
  [ "$(msg_lang zh colon_test 世界)" = "键：世界" ]
}

@test "msg_lang falls back to EN when target lang missing" {
  _i18n_set en only_en "fallback"
  # Deliberately no zh registration.
  [ "$(msg_lang zh only_en)" = "fallback" ]
}

@test "msg_lang with unknown locale uses tr fallback and resolves correctly" {
  _i18n_set fr bonjour "Bonjour!"
  [ "$(msg_lang fr bonjour)" = "Bonjour!" ]
}

@test "lib/i18n.sh sources cleanly under the running bash (no parse error)" {
  # If this regresses, the source in setup() would have failed already, but
  # an explicit bash -n provides a clean diagnostic.
  run bash -n "${LIB}/i18n.sh"
  [ "$status" -eq 0 ]
}
