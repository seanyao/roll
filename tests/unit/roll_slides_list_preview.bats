#!/usr/bin/env bats
# Unit tests for `roll slides list` and `roll slides preview` (US-DECK-005).
#
# Exercises cmd_slides_list() and cmd_slides_preview() in bin/roll:
#   list:
#     - Empty .roll/slides/ → friendly "no decks" message + exit 0
#     - Decks present, none built → table rows with ✗ in built column
#     - Decks present, some built → table rows with ✓ + size column populated
#     - Table header contains all required columns:
#         slug | template | total_slides | created | built | size
#     - --help shows bilingual help (inherits _slides_help)
#   preview:
#     - No slug arg → usage error
#     - Unknown slug (no <slug>.html) → friendly bilingual error + hint to build
#     - HTML exists → invokes opener (stubbed); exit 0
#     - --no-open suppresses opener; exit 0
#     - BATS_TEST_NUMBER env auto-suppresses opener (running here)
#
# Notes:
#   - Bilingual assertions use literal CJK substring matching; CJK Unicode
#     range regex is unreliable under the CI runner locale.
#   - The browser-open command (open / xdg-open) is stubbed via a PATH dir.

load helpers

setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── Stubs ───────────────────────────────────────────────────────────────────
# Stub the browser-open command so tests never spawn a UI process.
# We interpolate ${TEST_TMP} INTO the stub at stub-create time (unquoted heredoc)
# so the stub does not depend on TEST_TMP being exported into its subshell.
_stub_open_cmd() {
  mkdir -p "${TEST_TMP}/stubbin"
  cat >"${TEST_TMP}/stubbin/open" <<EOF
#!/usr/bin/env bash
printf 'STUB_OPEN_CALLED:%s\n' "\$*" >>"${TEST_TMP}/open.log"
EOF
  cat >"${TEST_TMP}/stubbin/xdg-open" <<EOF
#!/usr/bin/env bash
printf 'STUB_OPEN_CALLED:%s\n' "\$*" >>"${TEST_TMP}/open.log"
EOF
  chmod +x "${TEST_TMP}/stubbin/open" "${TEST_TMP}/stubbin/xdg-open"
  export PATH="${TEST_TMP}/stubbin:${PATH}"
  : >"${TEST_TMP}/open.log"
}

# Seed a deck.md (frontmatter only) for a given slug + template/total/created.
# Optionally seed a matching .roll/slides/<slug>.html when `built` is non-empty.
_seed_deck_minimal() {
  local slug="$1"
  local template="${2:-introduction-v3}"
  local total="${3:-3}"
  local created="${4:-2026-05-21}"
  local built="${5:-}"
  mkdir -p ".roll/slides/${slug}"
  cat >".roll/slides/${slug}/deck.md" <<EOF
---
template: ${template}
slug: ${slug}
title_en: "Title EN"
title_zh: "标题"
total_slides: ${total}
created: ${created}
---

## Slide 1
title_en: "x"
EOF
  if [[ -n "$built" ]]; then
    mkdir -p ".roll/slides"
    printf '<html><body>%s</body></html>\n' "$slug" >".roll/slides/${slug}.html"
  fi
}

# ─── list: empty / friendly path ─────────────────────────────────────────────

@test "cmd_slides list: empty .roll/slides/ → friendly bilingual 'no decks' message + exit 0" {
  run cmd_slides list
  [ "$status" -eq 0 ]
  [[ "$output" == *"No decks"* || "$output" == *"no decks"* ]]
  [[ "$output" == *"幻灯片"* || "$output" == *"无"* ]]
}

@test "cmd_slides list: no .roll/ directory at all → friendly 'no decks' + exit 0" {
  run cmd_slides list
  [ "$status" -eq 0 ]
  [[ "$output" == *"No decks"* || "$output" == *"no decks"* ]]
}

# ─── list: table output ──────────────────────────────────────────────────────

@test "cmd_slides list: header contains all required columns" {
  _seed_deck_minimal roll-intro introduction-v3 3 2026-05-21 ""
  run cmd_slides list
  [ "$status" -eq 0 ]
  [[ "$output" == *"slug"* ]]
  [[ "$output" == *"template"* ]]
  [[ "$output" == *"total_slides"* || "$output" == *"slides"* ]]
  [[ "$output" == *"created"* ]]
  [[ "$output" == *"built"* ]]
  [[ "$output" == *"size"* ]]
}

@test "cmd_slides list: unbuilt deck shows ✗ in the built column" {
  _seed_deck_minimal alpha introduction-v3 3 2026-05-21 ""
  run cmd_slides list
  [ "$status" -eq 0 ]
  [[ "$output" == *"alpha"* ]]
  [[ "$output" == *"✗"* ]]
}

@test "cmd_slides list: built deck shows ✓ + non-empty size column" {
  _seed_deck_minimal beta introduction-v3 5 2026-05-21 yes
  run cmd_slides list
  [ "$status" -eq 0 ]
  [[ "$output" == *"beta"* ]]
  [[ "$output" == *"✓"* ]]
  echo "$output" | grep -E 'beta.*[0-9]+' >/dev/null
}

@test "cmd_slides list: mixed built/unbuilt decks render both rows" {
  _seed_deck_minimal alpha introduction-v3 3 2026-05-21 ""
  _seed_deck_minimal beta  introduction-v3 5 2026-05-22 yes
  run cmd_slides list
  [ "$status" -eq 0 ]
  [[ "$output" == *"alpha"* ]]
  [[ "$output" == *"beta"* ]]
  [[ "$output" == *"✓"* ]]
  [[ "$output" == *"✗"* ]]
}

@test "cmd_slides list: includes template + total_slides + created values from frontmatter" {
  _seed_deck_minimal gamma my-custom-tpl 7 2026-04-01 ""
  run cmd_slides list
  [ "$status" -eq 0 ]
  [[ "$output" == *"gamma"* ]]
  [[ "$output" == *"my-custom-tpl"* ]]
  [[ "$output" == *"7"* ]]
  [[ "$output" == *"2026-04-01"* ]]
}

# ─── preview: argument validation ────────────────────────────────────────────

@test "cmd_slides preview: no slug arg → usage error + non-zero exit" {
  run cmd_slides preview
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage"* || "$output" == *"slug"* || "$output" == *"用法"* ]]
}

# ─── preview: missing HTML ───────────────────────────────────────────────────

@test "cmd_slides preview: missing <slug>.html → bilingual error + hint to build" {
  run cmd_slides preview does-not-exist
  [ "$status" -ne 0 ]
  [[ "$output" == *"does-not-exist"* ]]
  [[ "$output" == *"roll slides build"* ]]
  [[ "$output" == *"先"* || "$output" == *"未找到"* ]]
}

# ─── preview: happy path ─────────────────────────────────────────────────────

@test "cmd_slides preview: existing <slug>.html → exit 0 (BATS_TEST_NUMBER auto-suppresses opener)" {
  _seed_deck_minimal delta introduction-v3 3 2026-05-21 yes
  _stub_open_cmd
  run cmd_slides preview delta
  [ "$status" -eq 0 ]
  # Inside bats, BATS_TEST_NUMBER is set → opener should NOT be invoked.
  [ ! -s "${TEST_TMP}/open.log" ]
  [[ "$output" == *".roll/slides/delta.html"* ]]
}

@test "cmd_slides preview: --no-open prevents calling the browser-open command" {
  _seed_deck_minimal epsilon introduction-v3 3 2026-05-21 yes
  _stub_open_cmd
  run cmd_slides preview epsilon --no-open
  [ "$status" -eq 0 ]
  [ ! -s "${TEST_TMP}/open.log" ]
}

@test "cmd_slides preview: when forced to open (no BATS guard), opener is invoked exactly once" {
  _seed_deck_minimal zeta introduction-v3 3 2026-05-21 yes
  _stub_open_cmd
  # `run` spawns a subshell that inherits the parent env, so unsetting
  # BATS_TEST_NUMBER here doesn't apply to the cmd_slides_preview invocation.
  # Call it inline with the env vars explicitly unset for THIS process.
  (
    unset BATS_TEST_NUMBER
    unset ROLL_SLIDES_NO_OPEN
    cmd_slides preview zeta
  )
  [ "$?" -eq 0 ]
  [ -s "${TEST_TMP}/open.log" ]
  grep -q "STUB_OPEN_CALLED:.*\.roll/slides/zeta\.html" "${TEST_TMP}/open.log"
}

# ─── dispatch: --help still works (inherited from build story) ───────────────

@test "cmd_slides list --help shows bilingual help" {
  run cmd_slides list --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"list"* ]]
  [[ "$output" == *"幻灯片"* ]]
}

@test "cmd_slides preview --help shows bilingual help" {
  run cmd_slides preview --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"preview"* ]]
  [[ "$output" == *"幻灯片"* ]]
}
