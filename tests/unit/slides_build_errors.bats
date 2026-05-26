#!/usr/bin/env bats
# US-DECK-012: build failure recovery paths — template missing, validator
# failed, renderer crashed. Each failure path exits non-zero and gives the
# user a concrete next step instead of a generic error.

load helpers

setup()    { unit_setup_cd; }
teardown() { unit_teardown_cd; }

REPO="${BATS_TEST_DIRNAME}/../.."

_stub_open_cmd() {
  mkdir -p "${TEST_TMP}/stubbin"
  cat >"${TEST_TMP}/stubbin/open" <<'EOF'
#!/usr/bin/env bash
printf 'STUB_OPEN_CALLED:%s\n' "$*" >>"${TEST_TMP}/open.log"
EOF
  cat >"${TEST_TMP}/stubbin/xdg-open" <<'EOF'
#!/usr/bin/env bash
printf 'STUB_OPEN_CALLED:%s\n' "$*" >>"${TEST_TMP}/open.log"
EOF
  chmod +x "${TEST_TMP}/stubbin/open" "${TEST_TMP}/stubbin/xdg-open"
  export PATH="${TEST_TMP}/stubbin:${PATH}"
  : >"${TEST_TMP}/open.log"
}

# Stub python3 to crash when called with slides-render.py, while passing
# through validator and other python3 calls to the real binary.
_stub_python3_render_crash() {
  local real_python3
  real_python3=$(command -v python3 2>/dev/null || echo /usr/bin/python3)
  mkdir -p "${TEST_TMP}/stubbin"
  cat >"${TEST_TMP}/stubbin/python3" <<PYEOF
#!/usr/bin/env bash
for arg in "\$@"; do
  case "\$arg" in
    *slides-render.py*)
      echo "Traceback (most recent call last):" >&2
      echo "  File \"slides-render.py\", line 42, in render_deck" >&2
      echo "    result = template.render(ctx)" >&2
      echo "  File \"slides-render.py\", line 87, in render" >&2
      echo "RuntimeError: division by zero in slide layout" >&2
      exit 1
      ;;
  esac
done
exec "$real_python3" "\$@"
PYEOF
  chmod +x "${TEST_TMP}/stubbin/python3"
  export PATH="${TEST_TMP}/stubbin:${PATH}"
}

# ─── Template missing ────────────────────────────────────────────────────────

@test "slides build: template not found → lists available templates + suggests roll slides templates" {
  local slug="no-tpl-deck"
  mkdir -p ".roll/slides/${slug}"
  # Schema-valid deck referencing a template that does not exist.
  cat >".roll/slides/${slug}/deck.md" <<'EOF'
---
template: nosuch-template
slug: no-tpl-deck
title_en: "Test"
title_zh: "测试"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: "One"
title_zh: "一"
body_en: |
  Hello.
body_zh: |
  你好。
evidence:
  - README.md:1
EOF
  _stub_open_cmd
  run cmd_slides build "$slug" --no-open
  [ "$status" -ne 0 ]
  # Error must name the missing template
  [[ "$output" == *"nosuch-template"* ]]
  # Must list available templates (at least "introduction-v3" builtin)
  [[ "$output" == *"introduction-v3"* ]]
  # Must suggest the templates command
  [[ "$output" == *"roll slides templates"* ]]
  # [FAIL] prefix
  [[ "$output" == *"[FAIL]"* ]]
}

@test "slides build: template not found → writes .last-build.err" {
  local slug="no-tpl-deck2"
  mkdir -p ".roll/slides/${slug}"
  cat >".roll/slides/${slug}/deck.md" <<'EOF'
---
template: nosuch-template
slug: no-tpl-deck2
title_en: "Test"
title_zh: "测试"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: "One"
title_zh: "一"
body_en: |
  Hello.
body_zh: |
  你好。
evidence:
  - README.md:1
EOF
  _stub_open_cmd
  run cmd_slides build "$slug" --no-open
  [ "$status" -ne 0 ]
  [ -f ".roll/slides/${slug}/.last-build.err" ]
}

# ─── Validator failed ────────────────────────────────────────────────────────

@test "slides build: validator failed → [FAIL] prefix + hint with deck path" {
  local slug="bad-deck2"
  mkdir -p ".roll/slides/${slug}"
  # Missing required frontmatter fields → validator returns 1.
  cat >".roll/slides/${slug}/deck.md" <<'EOF'
---
template: introduction-v3
slug: bad-deck2
---

## Slide 1
title_en: "x"
EOF
  _stub_open_cmd
  run cmd_slides build "$slug" --no-open
  [ "$status" -ne 0 ]
  # [FAIL] prefix
  [[ "$output" == *"[FAIL]"* ]]
  # Must mention the deck path so user knows what file to edit
  [[ "$output" == *"${slug}"* ]]
  # Validator output still visible (existing behavior preserved)
  [[ "$output" == *"slides-validate"* || "$output" == *"missing required"* || "$output" == *"alidation"* ]]
}

# ─── Renderer crashed ────────────────────────────────────────────────────────

@test "slides build: renderer crashed → suggests roll slides logs + [FAIL] prefix" {
  local slug="crash-deck"
  mkdir -p ".roll/slides/${slug}"
  cat >".roll/slides/${slug}/deck.md" <<'EOF'
---
template: introduction-v3
slug: crash-deck
title_en: "Crash Test"
title_zh: "崩溃测试"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: "One"
title_zh: "一"
body_en: |
  Hello.
body_zh: |
  你好。
evidence:
  - README.md:1
EOF
  _stub_open_cmd
  _stub_python3_render_crash
  run cmd_slides build "$slug" --no-open
  [ "$status" -ne 0 ]
  # Must suggest logs command
  [[ "$output" == *"roll slides logs"* ]]
  # [FAIL] prefix
  [[ "$output" == *"[FAIL]"* ]]
  # Must contain Python traceback last lines
  [[ "$output" == *"RuntimeError"* || "$output" == *"Traceback"* ]]
}

@test "slides build: renderer crashed → writes .last-build.err with stage=render" {
  local slug="crash-deck2"
  mkdir -p ".roll/slides/${slug}"
  cat >".roll/slides/${slug}/deck.md" <<'EOF'
---
template: introduction-v3
slug: crash-deck2
title_en: "Crash Test"
title_zh: "崩溃测试"
total_slides: 1
created: 2026-05-21
---

## Slide 1
title_en: "One"
title_zh: "一"
body_en: |
  Hello.
body_zh: |
  你好。
evidence:
  - README.md:1
EOF
  _stub_open_cmd
  _stub_python3_render_crash
  run cmd_slides build "$slug" --no-open
  [ "$status" -ne 0 ]
  [ -f ".roll/slides/${slug}/.last-build.err" ]
  grep -q "stage=render" ".roll/slides/${slug}/.last-build.err"
}
