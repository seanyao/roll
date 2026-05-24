#!/usr/bin/env bats
# US-DECK-014: roll slides templates command

load helpers
setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

_setup_project_tpl() {
  local name="$1"
  mkdir -p ".roll/slides/templates"
  touch ".roll/slides/templates/${name}.html"
}

_setup_builtin_tpl() {
  local name="$1"
  mkdir -p "${ROLL_PKG_DIR}/lib/slides/templates"
  touch "${ROLL_PKG_DIR}/lib/slides/templates/${name}.html"
}

@test "templates: shows built-in and project templates" {
  _setup_builtin_tpl "introduction-v3"
  _setup_project_tpl "custom-theme"
  run bash "$ROLL_BIN" slides templates
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"introduction-v3"* ]]
  [[ "$output" == *"builtin"* ]]
  [[ "$output" == *"custom-theme"* ]]
  [[ "$output" == *"project"* ]]
}

@test "templates: no project-level templates (only built-in)" {
  run bash "$ROLL_BIN" slides templates
  [[ "$status" -eq 0 ]]
  # Built-in templates from ROLL_PKG_DIR always exist
  [[ "$output" == *"builtin"* ]]
}

@test "templates: only built-in templates" {
  _setup_builtin_tpl "introduction-v3"
  _setup_builtin_tpl "pitch"
  run bash "$ROLL_BIN" slides templates
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"introduction-v3"* ]]
  [[ "$output" == *"pitch"* ]]
  [[ "$output" == *"builtin"* ]]
}

@test "templates: only project templates" {
  _setup_project_tpl "my-brand"
  run bash "$ROLL_BIN" slides templates
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"my-brand"* ]]
  [[ "$output" == *"project"* ]]
}

@test "templates: handles unknown flag gracefully" {
  run bash "$ROLL_BIN" slides templates --unknown
  [[ "$status" -ne 0 ]]
}
