#!/usr/bin/env bats
# Regression net for the bash 3.2 release blocker.
#
# PR #211 replaced an awk fork with ${var^^} (bash 4+ syntax). macOS still
# ships bash 3.2.57, so the change made `bin/roll` unrunnable locally and
# tipped 125+ tests into setup failure. CI runs on Ubuntu (bash 5) and missed
# it. These tests source lib/i18n.sh in isolation and exercise every code
# path that uppercases — any future bash-4-only operator drops one of these.

LIB="${BATS_TEST_DIRNAME}/../../lib"

setup() {
  # Source in a subshell-free way so the helper functions are visible to @test.
  # shellcheck disable=SC1090,SC1091
  source "${LIB}/i18n.sh"
}

@test "_i18n_upper EN/ZH common path returns the literal" {
  [ "$(_i18n_upper en)" = "EN" ]
  [ "$(_i18n_upper zh)" = "ZH" ]
  [ "$(_i18n_upper EN)" = "EN" ]
  [ "$(_i18n_upper ZH)" = "ZH" ]
}

@test "_i18n_upper unknown locale falls back to tr (still uppercase)" {
  [ "$(_i18n_upper fr)" = "FR" ]
  [ "$(_i18n_upper ja)" = "JA" ]
}

@test "_i18n_set populates MSG_EN_<key> without bash 4+ syntax" {
  _i18n_set en greeting "Hello, %s!"
  [ "$MSG_EN_greeting" = "Hello, %s!" ]
}

@test "_i18n_set populates MSG_ZH_<key> with CJK payload" {
  _i18n_set zh greeting "你好，%s！"
  [ "$MSG_ZH_greeting" = "你好，%s！" ]
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

@test "lib/i18n.sh sources cleanly under the running bash (no parse error)" {
  # If this regresses, the source in setup() would have failed already, but
  # an explicit bash -n provides a clean diagnostic.
  run bash -n "${LIB}/i18n.sh"
  [ "$status" -eq 0 ]
}
