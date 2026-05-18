#!/usr/bin/env bats
# Tests for REFACTOR-013: document $ROLL_CONFIG / $ROLL_GLOBAL / $ROLL_HOME
# in user-facing docs so users can discover the override entry points.

EN="${BATS_TEST_DIRNAME}/../../guide/en/configuration.md"
ZH="${BATS_TEST_DIRNAME}/../../guide/zh/configuration.md"

@test "EN configuration.md documents ROLL_HOME, ROLL_CONFIG, ROLL_GLOBAL" {
  grep -qF 'ROLL_HOME' "$EN"
  grep -qF 'ROLL_CONFIG' "$EN"
  grep -qF 'ROLL_GLOBAL' "$EN"
}

@test "EN configuration.md shows default values for ROLL_HOME, ROLL_CONFIG, ROLL_GLOBAL" {
  grep -qF '~/.roll' "$EN"
  grep -qF 'config.yaml' "$EN"
  grep -qF 'conventions/global' "$EN"
}

@test "EN configuration.md shows override example" {
  grep -qE 'export ROLL_HOME=|ROLL_HOME=' "$EN"
}

@test "ZH configuration.md documents ROLL_HOME, ROLL_CONFIG, ROLL_GLOBAL" {
  grep -qF 'ROLL_HOME' "$ZH"
  grep -qF 'ROLL_CONFIG' "$ZH"
  grep -qF 'ROLL_GLOBAL' "$ZH"
}

@test "ZH configuration.md has Chinese content" {
  grep -qE '配置|环境变量|覆盖|默认' "$ZH"
}

@test "EN overview.md links to configuration.md" {
  grep -qF 'configuration.md' "${BATS_TEST_DIRNAME}/../../guide/en/overview.md"
}

@test "ZH overview.md links to configuration.md" {
  grep -qF 'configuration.md' "${BATS_TEST_DIRNAME}/../../guide/zh/overview.md"
}
