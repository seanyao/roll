#!/usr/bin/env bats
# US-QA-010b: bats unit tests covering the rubric's ❼ (inlining external-tool
# behaviour) and ❽ (file outside repo) categories. We test the rubric's own
# structural integrity (every category exposes the four required subsections)
# and lock the headline numbers across EN + ZH variants so a future content
# refresh doesn't silently drop the new categories.

EN_RUBRIC="${BATS_TEST_DIRNAME}/../../guide/en/testing/quality-rubric.md"
ZH_RUBRIC="${BATS_TEST_DIRNAME}/../../guide/zh/testing/quality-rubric.md"

@test "EN rubric: has category ❼ (inline external-tool behaviour)" {
  grep -qE '^## ❼' "$EN_RUBRIC"
}

@test "EN rubric: has category ❽ (file outside repo)" {
  grep -qE '^## ❽' "$EN_RUBRIC"
}

@test "EN rubric: announces 'eight' anti-patterns (not 'six')" {
  grep -qE 'eight anti-pattern' "$EN_RUBRIC"
  ! grep -qE '^This rubric publishes six anti-pattern' "$EN_RUBRIC"
}

@test "ZH rubric: has category ❼" {
  grep -qE '^## ❼' "$ZH_RUBRIC"
}

@test "ZH rubric: has category ❽" {
  grep -qE '^## ❽' "$ZH_RUBRIC"
}

# Structural integrity: each new category exposes Definition / Signals /
# Fix template subsections. We accept English or Chinese headings.
_section_between() {
  local file="$1" start_h2="$2" end_h2="$3"
  awk -v start="$start_h2" -v stop="$end_h2" '
    $0 ~ "^## " start { capturing=1; next }
    capturing && $0 ~ "^## " stop { exit }
    capturing { print }
  ' "$file"
}

@test "EN rubric ❼ section has Definition / Signals / Fix template" {
  local body; body=$(_section_between "$EN_RUBRIC" "❼" "❽")
  echo "$body" | grep -qE '^### Definition'
  echo "$body" | grep -qE '^### Signals'
  echo "$body" | grep -qE '^### Fix template'
}

@test "EN rubric ❽ section has Definition / Signals / Fix template" {
  local body; body=$(_section_between "$EN_RUBRIC" "❽" "[^❽]")
  echo "$body" | grep -qE '^### Definition'
  echo "$body" | grep -qE '^### Signals'
  echo "$body" | grep -qE '^### Fix template'
}

@test "ZH rubric ❼ section has Definition (定义) / Signals (信号) / Fix template (修复模板)" {
  local body; body=$(_section_between "$ZH_RUBRIC" "❼" "❽")
  # Accept either English subheadings (mirrors EN) or Chinese subheadings.
  echo "$body" | grep -qE '^### (Definition|定义)'
  echo "$body" | grep -qE '^### (Signals|信号|判定信号)'
  echo "$body" | grep -qE '^### (Fix template|修复模板|最小修复模板)'
}

@test "ZH rubric ❽ section has Definition / Signals / Fix template" {
  local body; body=$(_section_between "$ZH_RUBRIC" "❽" "[^❽]")
  echo "$body" | grep -qE '^### (Definition|定义)'
  echo "$body" | grep -qE '^### (Signals|信号|判定信号)'
  echo "$body" | grep -qE '^### (Fix template|修复模板|最小修复模板)'
}

@test "rubric headline order ❶ → ❽ is contiguous (no gaps)" {
  # All eight category headings present in EN.
  local h
  for h in ❶ ❷ ❸ ❹ ❺ ❻ ❼ ❽; do
    grep -qE "^## $h" "$EN_RUBRIC"
  done
}

@test "EN ❼ Signals mention sed / awk / grep / find as inline patterns" {
  local body; body=$(_section_between "$EN_RUBRIC" "❼" "❽")
  echo "$body" | grep -qE 'sed|awk|grep|find'
}

@test "EN ❽ Signals mention paths outside the repo (~/, /etc, /home)" {
  local body; body=$(_section_between "$EN_RUBRIC" "❽" "[^❽]")
  echo "$body" | grep -qE '~/|/etc|/home|outside.*repo|outside this repo'
}
