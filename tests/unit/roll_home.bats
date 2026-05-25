#!/usr/bin/env bats
# Unit tests for lib/roll-home.py + _home dispatch (US-VIEW-002)

LIB="${BATS_TEST_DIRNAME}/../../lib"
ROLL_BIN="${BATS_TEST_DIRNAME}/../../bin/roll"

# FIX-076: fixture data is gated on the ROLL_RENDER_FIXTURE env var; user-facing
# CLI no longer exposes --demo. Tests opt into fixture rendering explicitly.
_run_fixture() {
  ROLL_RENDER_FIXTURE=1 run python3 "${LIB}/roll-home.py" --no-color "$@"
}

@test "roll-home _project_slug matches roll-loop-status project_slug (no slug drift)" {
  # Regression for FIX-H 2026-05-25: lib/roll-home.py kept the path-based
  # slug after US-OBS-010 migrated bin/roll + lib/roll-loop-status.py to
  # remote-URL-based. Result: `roll` home dash looked for plists at the
  # old slug while `roll loop status` looked at the new slug — the home
  # banner reported "missing" while the loop was actually healthy.
  # Both modules must agree.
  cd "${BATS_TEST_DIRNAME}/../.."
  local home_slug status_slug
  home_slug=$(python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('rh', '${LIB}/roll-home.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._project_slug())
")
  status_slug=$(python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('rls', '${LIB}/roll-loop-status.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.project_slug())
")
  [ -n "$home_slug" ]
  [ "$home_slug" = "$status_slug" ]
}

@test "roll-home fixture --no-color: exits 0 and has identity line" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll ·"* ]]
}

@test "roll-home fixture --no-color: includes THREE LAYERS section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"THREE LAYERS"* ]]
}

@test "roll-home fixture --no-color: includes FOUR DEFENSES section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"FOUR DEFENSES"* ]]
}

@test "roll-home fixture --no-color: includes PIPELINE section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"PIPELINE"* ]]
}

@test "roll-home fixture --no-color: includes NEED YOU section" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"NEED YOU"* ]]
}

@test "roll-home fixture --no-color: includes quick-nav footer" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" == *"roll loop"* ]]
  [[ "$output" == *"roll --help"* ]]
}

@test "roll-home fixture: --no-color suppresses ANSI escapes" {
  _run_fixture
  [ "$status" -eq 0 ]
  [[ "$output" != *$'\033['* ]]
}

@test "_home dispatch: ROLL_UI=v2 routes to roll-home.py" {
  body=$(awk '/^_home\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"roll-home.py"* ]]
}

@test "_home dispatch: ROLL_UI=v1 routes to _legacy_home" {
  body=$(awk '/^_home\(\)/{p=1} p{print} p && /^\}$/{p=0}' "$ROLL_BIN")
  [[ "$body" == *"_legacy_home"* ]]
}

@test "FIX-117: _resolve_project_agent prefers .roll/local.yaml agent over config primary_agent" {
  local tmp; tmp=$(mktemp -d)
  cd "$tmp"
  mkdir -p .roll
  echo "agent: pi" > .roll/local.yaml
  run python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('rh', '${LIB}/roll-home.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._resolve_project_agent({'primary_agent': 'claude'}))
"
  cd - >/dev/null
  rm -rf "$tmp"
  [ "$status" -eq 0 ]
  [ "$output" = "pi" ]
}

@test "FIX-117: _resolve_project_agent falls back to config primary_agent when no project file" {
  local tmp; tmp=$(mktemp -d)
  cd "$tmp"
  run python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('rh', '${LIB}/roll-home.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._resolve_project_agent({'primary_agent': 'kimi'}))
"
  cd - >/dev/null
  rm -rf "$tmp"
  [ "$status" -eq 0 ]
  [ "$output" = "kimi" ]
}

@test "FIX-117: _resolve_project_agent defaults to claude when nothing set" {
  local tmp; tmp=$(mktemp -d)
  cd "$tmp"
  run python3 -c "
import sys, importlib.util
spec = importlib.util.spec_from_file_location('rh', '${LIB}/roll-home.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m._resolve_project_agent({}))
"
  cd - >/dev/null
  rm -rf "$tmp"
  [ "$status" -eq 0 ]
  [ "$output" = "claude" ]
}

@test "FIX-117: home banner reads project agent override" {
  local tmp; tmp=$(mktemp -d)
  cd "$tmp"
  mkdir -p .roll
  echo "agent: pi" > .roll/local.yaml
  run python3 "${LIB}/roll-home.py" --no-color
  cd - >/dev/null
  rm -rf "$tmp"
  [ "$status" -eq 0 ]
  [[ "$output" == *"agent pi"* ]]
}
