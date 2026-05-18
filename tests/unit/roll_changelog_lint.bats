#!/usr/bin/env bats
# Unit tests for: _changelog_lint_bullet, _changelog_style_anchors (US-CL-004)

load helpers

setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── _changelog_lint_bullet ────────────────────────────────────────────────

@test "_changelog_lint_bullet: clean user-facing bullet passes" {
  run _changelog_lint_bullet "- **Added**: 一键升级到最新版"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_changelog_lint_bullet: rejects backtick identifier with underscore" {
  run _changelog_lint_bullet '- **Fixed**: `_write_runner` 加了锁'
  echo "$output" | grep -q backtick-identifier
}

@test "_changelog_lint_bullet: rejects backtick fn() form" {
  run _changelog_lint_bullet '- **Fixed**: `fn()` 不再崩溃'
  echo "$output" | grep -q backtick-identifier
}

@test "_changelog_lint_bullet: rejects file suffix .md outside backticks" {
  run _changelog_lint_bullet "- **Added**: .roll/backlog.md 加新栏"
  echo "$output" | grep -q file-suffix
}

@test "_changelog_lint_bullet: rejects .sh suffix outside backticks" {
  run _changelog_lint_bullet "- **Added**: 改了 release.sh"
  echo "$output" | grep -q file-suffix
}

@test "_changelog_lint_bullet: rejects .yml suffix outside backticks" {
  run _changelog_lint_bullet "- **Fixed**: ci.yml 矩阵化"
  echo "$output" | grep -q file-suffix
}

@test "_changelog_lint_bullet: allows file suffix inside backticks (user cmd)" {
  run _changelog_lint_bullet '- **Added**: `roll edit notes.md` 直接打开'
  ! echo "$output" | grep -q file-suffix
}

@test "_changelog_lint_bullet: rejects 'Phase N' jargon" {
  run _changelog_lint_bullet "- **Added**: Phase 11 加 CI gate"
  echo "$output" | grep -q internal-word
}

@test "_changelog_lint_bullet: rejects 'Step N' jargon" {
  run _changelog_lint_bullet "- **Added**: Step 5 加 lint"
  echo "$output" | grep -q internal-word
}

@test "_changelog_lint_bullet: rejects 'Helper' jargon" {
  run _changelog_lint_bullet "- **Added**: 新增 Helper 函数"
  echo "$output" | grep -q internal-word
}

@test "_changelog_lint_bullet: rejects 'Schema' jargon" {
  run _changelog_lint_bullet "- **Fixed**: runs Schema 漂移"
  echo "$output" | grep -q internal-word
}

@test "_changelog_lint_bullet: rejects 'Fixture' jargon" {
  run _changelog_lint_bullet "- **Fixed**: Fixture 不再泄漏"
  echo "$output" | grep -q internal-word
}

@test "_changelog_lint_bullet: rejects 'Refactor' jargon" {
  run _changelog_lint_bullet "- **Changed**: Refactor 拆分"
  echo "$output" | grep -q internal-word
}

@test "_changelog_lint_bullet: rejects bullet over 50 chars" {
  local long="- **Added**: 这是一个非常非常非常非常非常非常非常非常长的描述，绝对超过五十个字符的限制了真的"
  run _changelog_lint_bullet "$long"
  echo "$output" | grep -q over-length
}

@test "_changelog_lint_bullet: passes bullet under 50 chars" {
  run _changelog_lint_bullet "- **Added**: 短描述"
  ! echo "$output" | grep -q over-length
}

@test "_changelog_lint_bullet: rejects path fragment 'bin/'" {
  run _changelog_lint_bullet "- **Fixed**: bin/roll 新命令"
  echo "$output" | grep -q path-fragment
}

@test "_changelog_lint_bullet: rejects path fragment 'tests/'" {
  run _changelog_lint_bullet "- **Added**: tests/unit 加用例"
  echo "$output" | grep -q path-fragment
}

@test "_changelog_lint_bullet: rejects path fragment 'docs/'" {
  run _changelog_lint_bullet "- **Added**: .roll/features 新增 plan"
  echo "$output" | grep -q path-fragment
}

@test "_changelog_lint_bullet: rejects path fragment 'scripts/'" {
  run _changelog_lint_bullet "- **Changed**: scripts/release 升级"
  echo "$output" | grep -q path-fragment
}

@test "_changelog_lint_bullet: allows path fragment inside backticks" {
  run _changelog_lint_bullet '- **Added**: 用 `ls docs/` 查目录'
  ! echo "$output" | grep -q path-fragment
}

@test "_changelog_lint_bullet: surfaces multiple violations at once" {
  run _changelog_lint_bullet '- **Fixed**: Phase 5 给 `_foo()` 加 Helper'
  local lines; lines=$(echo "$output" | grep -c '^[a-z]')
  [ "$lines" -ge 2 ]
}

# Regression: 10 tech-jargon drafts representative of the v2026.513.1
# pre-rewrite state — all must trigger at least one violation.
@test "_changelog_lint_bullet: 10 tech-jargon drafts all flagged" {
  local drafts=(
    '- **Added**: `_write_loop_runner_script` 加锁防并发'
    '- **Fixed**: bin/roll 改为 gh -R 强制传 slug'
    '- **Changed**: tests/unit Schema 锁定 enum'
    '- **Added**: `roll loop runs` 写 jsonl Fixture'
    '- **Fixed**: Phase 11 在 CI 绿之前不再标 Done'
    '- **Added**: Step 5.4 mechanical lint Helper'
    '- **Changed**: Refactor 拆 ci.yml 为 matrix'
    '- **Fixed**: `_dash_release_ready` 加 tag gate'
    '- **Added**: .roll/features 新增 plan 文件'
    '- **Fixed**: REFINE/OBJECT 路径未 local Helper 变量'
  )
  local hit=0 d
  for d in "${drafts[@]}"; do
    run _changelog_lint_bullet "$d"
    [ -n "$output" ] && hit=$((hit + 1))
  done
  [ "$hit" -eq 10 ]
}

# ─── _changelog_style_anchors ──────────────────────────────────────────────

@test "_changelog_style_anchors: empty output when CHANGELOG.md missing" {
  run _changelog_style_anchors
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "_changelog_style_anchors: pulls bullets from latest 3 versions" {
  cat > CHANGELOG.md <<'EOF'
# Changelog

## Unreleased
- **Added**: unreleased entry should be skipped

## v2026.01.01
- **Added**: bullet from v1
- **Fixed**: another v1 bullet

## v2025.12.31
- **Added**: bullet from v2

## v2025.12.30
- **Fixed**: bullet from v3

## v2025.12.29
- **Changed**: bullet from v4 should NOT appear (4th)
EOF
  local out; out=$(_changelog_style_anchors)
  echo "$out" | grep -q "bullet from v1"
  echo "$out" | grep -q "another v1 bullet"
  echo "$out" | grep -q "bullet from v2"
  echo "$out" | grep -q "bullet from v3"
  ! echo "$out" | grep -q "unreleased entry"
  ! echo "$out" | grep -q "from v4"
}

@test "_changelog_style_anchors: output truncated to ~1500 chars" {
  {
    echo "# Changelog"
    echo
    echo "## v2026.01.01"
    for i in $(seq 1 200); do
      echo "- **Added**: 这是第 ${i} 条很长的填充条目用来撑爆字数上限测试截断逻辑"
    done
  } > CHANGELOG.md
  local out; out=$(_changelog_style_anchors)
  local len; len=$(printf '%s' "$out" | wc -c | tr -d ' ')
  [ "$len" -le 1500 ]
}
