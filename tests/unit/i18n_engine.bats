#!/usr/bin/env bats

# US-I18N-001: i18n engine — locale resolution, message catalog, roll lang command.
# Test-first per kimi peer-review refinement: verify engine before migrating any
# production strings.

load helpers

setup() {
  unit_setup_cd
  # Pretend we're in a Roll project so cmd_lang doesn't refuse to run.
  mkdir -p .roll
  : > .roll/backlog.md
  export ROLL_HOME="${TEST_TMP}/dot-roll"
  mkdir -p "$ROLL_HOME"
  export ROLL_CONFIG="${ROLL_HOME}/config.yaml"
  unset ROLL_LANG ROLL_LANG_RESOLVED
  unset LC_ALL LANG
}

teardown() { unit_teardown_cd; }

# ── _i18n_resolve_lang precedence ─────────────────────────────────────────────

@test "_i18n_resolve_lang: defaults to en when no source matches" {
  # Shadow `defaults` so macOS AppleLanguages doesn't bleed into the test.
  defaults() { return 1; }
  export -f defaults
  run _i18n_resolve_lang
  [ "$status" -eq 0 ]
  [ "$output" = "en" ]
}

@test "_i18n_resolve_lang: ROLL_LANG=zh wins" {
  ROLL_LANG=zh run _i18n_resolve_lang
  [ "$output" = "zh" ]
}

@test "_i18n_resolve_lang: ROLL_LANG=en wins" {
  ROLL_LANG=en run _i18n_resolve_lang
  [ "$output" = "en" ]
}

@test "_i18n_resolve_lang: zh-prefixed LANG → zh" {
  LANG=zh_CN.UTF-8 run _i18n_resolve_lang
  [ "$output" = "zh" ]
}

@test "_i18n_resolve_lang: non-zh LANG → en" {
  LANG=fr_FR.UTF-8 run _i18n_resolve_lang
  [ "$output" = "en" ]
}

@test "_i18n_resolve_lang: LC_ALL beats LANG" {
  LC_ALL=zh_CN.UTF-8 LANG=en_US.UTF-8 run _i18n_resolve_lang
  [ "$output" = "zh" ]
}

@test "_i18n_resolve_lang: config lang beats LANG" {
  printf 'lang: zh\n' > "$ROLL_CONFIG"
  LANG=en_US.UTF-8 run _i18n_resolve_lang
  [ "$output" = "zh" ]
}

@test "_i18n_resolve_lang: ROLL_LANG env beats config" {
  printf 'lang: zh\n' > "$ROLL_CONFIG"
  ROLL_LANG=en run _i18n_resolve_lang
  [ "$output" = "en" ]
}

@test "_i18n_resolve_lang: caches result in ROLL_LANG_RESOLVED" {
  ROLL_LANG=zh _i18n_resolve_lang >/dev/null
  [ "${ROLL_LANG_RESOLVED:-}" = "zh" ]
}

# ── msg catalog lookup ────────────────────────────────────────────────────────

@test "msg: returns ZH text when lang=zh" {
  _i18n_set zh hello "你好"
  _i18n_set en hello "hello"
  ROLL_LANG=zh run msg hello
  [ "$output" = "你好" ]
}

@test "msg: returns EN text when lang=en" {
  _i18n_set zh hello "你好"
  _i18n_set en hello "hello"
  ROLL_LANG=en run msg hello
  [ "$output" = "hello" ]
}

@test "msg: falls back to EN when ZH missing" {
  _i18n_set en only_en "english only"
  ROLL_LANG=zh run msg only_en
  [ "$output" = "english only" ]
}

@test "msg: returns key itself when neither lang has it" {
  ROLL_LANG=zh run msg totally_missing_key
  [ "$output" = "totally_missing_key" ]
}

@test "msg: %s substitution" {
  _i18n_set en greet "Hello, %s!"
  ROLL_LANG=en run msg greet "Sean"
  [ "$output" = "Hello, Sean!" ]
}

@test "msg: %d substitution" {
  _i18n_set en count "found %d items"
  ROLL_LANG=en run msg count 7
  [ "$output" = "found 7 items" ]
}

@test "msg: dotted key works via safe-key sanitization" {
  _i18n_set en init.legacy_detected "Legacy project detected"
  ROLL_LANG=en run msg init.legacy_detected
  [ "$output" = "Legacy project detected" ]
}

# ── cmd_lang command ──────────────────────────────────────────────────────────

@test "cmd_lang: bare invocation shows current language and source" {
  printf 'lang: zh\n' > "$ROLL_CONFIG"
  run cmd_lang
  [ "$status" -eq 0 ]
  [[ "$output" == *"zh"* ]]
  [[ "$output" == *"config"* ]]
}

@test "cmd_lang: bare shows source=env when ROLL_LANG set" {
  ROLL_LANG=en run cmd_lang
  [ "$status" -eq 0 ]
  [[ "$output" == *"en"* ]]
  [[ "$output" == *"ROLL_LANG"* ]]
}

@test "cmd_lang: zh persists to config" {
  run cmd_lang zh
  [ "$status" -eq 0 ]
  grep -q "^lang: zh" "$ROLL_CONFIG"
}

@test "cmd_lang: en persists to config" {
  run cmd_lang en
  [ "$status" -eq 0 ]
  grep -q "^lang: en" "$ROLL_CONFIG"
}

@test "cmd_lang: switching overwrites existing lang line" {
  printf 'lang: zh\n' > "$ROLL_CONFIG"
  run cmd_lang en
  [ "$status" -eq 0 ]
  grep -q "^lang: en" "$ROLL_CONFIG"
  ! grep -q "^lang: zh" "$ROLL_CONFIG"
}

@test "cmd_lang: --reset removes lang from config" {
  printf 'lang: zh\nother: keep\n' > "$ROLL_CONFIG"
  run cmd_lang --reset
  [ "$status" -eq 0 ]
  ! grep -q "^lang:" "$ROLL_CONFIG"
  grep -q "^other: keep" "$ROLL_CONFIG"
}

@test "cmd_lang: invalid value errors with non-zero exit" {
  run cmd_lang fr
  [ "$status" -ne 0 ]
  [[ "$output" == *"zh"* ]]
  [[ "$output" == *"en"* ]]
}

# ── _strw CJK display width (US-I18N-006) ───────────────────────────────

@test "_strw: ASCII string returns char count" {
  run _strw "hello"
  [ "$output" -eq 5 ]
}

@test "_strw: CJK character counts as 2" {
  run _strw "中"
  [ "$output" -eq 2 ]
}

@test "_strw: mixed EN/ZH string calculates visual width" {
  # "你好AB" = 2+2+1+1 = 6
  run _strw "你好AB"
  [ "$output" -eq 6 ]
}

@test "_strw: emoji counts correctly (fullwidth)" {
  # Most emoji are wide
  run _strw "✅"
  [ "$output" -eq 2 ]
}

@test "_strw: empty string returns 0" {
  run _strw ""
  [ "$output" -eq 0 ]
}

# ── _pad_l / _pad_r (US-I18N-006) ──────────────────────────────────────

@test "_pad_l: pads ASCII string to target visual width" {
  run _pad_l "hi" 6
  (( ${#output} == 6 ))   # 2 chars + 4 spaces
  [[ "$output" == "hi    " ]]
}

@test "_pad_l: CJK string pads correctly (2 cells per char)" {
  # "中" = 2 cells → pad to 6 → 4 spaces after.
  # FIX-126: dropped `(( ${#output} == 7 ))` — byte-count assertion is
  # locale-dependent (works on LANG=C but fails on en_US.UTF-8 with bash 5).
  # Exact-match below already validates the output; visual width verified by
  # _strw tests above.
  run _pad_l "中" 6
  [[ "$output" == "中    " ]]
}

@test "_pad_l: no padding when string wider than target" {
  run _pad_l "hello world" 5
  [ "$output" = "hello world" ]
}

@test "_pad_l: exact width needs no padding" {
  run _pad_l "abc" 3
  [ "$output" = "abc" ]
}

@test "_pad_r: right-pads ASCII string" {
  run _pad_r "hi" 6
  (( ${#output} == 6 ))
  [[ "$output" == "    hi" ]]
}

@test "_pad_r: right-pads CJK string" {
  # "中" = 2 cells → right-pad to 6 → 4 spaces before. See FIX-126 note on
  # _pad_l above for why the byte-count assertion was removed.
  run _pad_r "中" 6
  [[ "$output" == "    中" ]]
}

@test "_pad_r: no padding when string wider than target" {
  run _pad_r "hello world" 5
  [ "$output" = "hello world" ]
}
