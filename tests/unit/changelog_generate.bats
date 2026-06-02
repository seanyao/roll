#!/usr/bin/env bats
# US-CL-006: roll changelog generate — deterministic draft from backlog Done stories.
# bats tier: fast

load helpers

GEN="${BATS_TEST_DIRNAME}/../../lib/changelog_generate.py"

setup() { unit_setup_cd; }
teardown() { unit_teardown_cd; }

# ─── Extraction ──────────────────────────────────────────────────────────────

@test "changelog_generate: extracts ✅ Done stories from backlog" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog

| Story | Description | Status |
|-------|-------------|--------|
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
| [FIX-101](x.md) | 修复崩溃问题 | ✅ Done |
| [US-FOO-002](x.md) | 待办的故事 | 📋 Todo |
EOF
  run python3 "$GEN" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['stories_drafted'] == 2"
}

@test "changelog_generate: skips stories already in CHANGELOG.md" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
| [FIX-101](x.md) | 修复崩溃问题 | ✅ Done |
EOF
  cat > CHANGELOG.md <<'EOF'
# Changelog
## Unreleased
- 新增一键安装 [loop]
## v1.0.0
- old
EOF
  run python3 "$GEN" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['stories_drafted'] == 1"
  echo "$output" | grep -q "FIX-101"
}

@test "changelog_generate: skips internal entries (test infra)" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
| [FIX-101](x.md) | bats 测试修复隔离问题 | ✅ Done |
EOF
  run python3 "$GEN" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['stories_drafted'] == 1"
}

@test "changelog_generate: cleans depends-on and manual-only tags" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增功能 `depends-on:US-FOO-002` | ✅ Done |
| [FIX-101](x.md) | 修复问题 manual-only:true | ✅ Done |
EOF
  run python3 "$GEN" --json
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "新增功能"
  ! echo "$output" | grep -q "depends-on"
  ! echo "$output" | grep -q "manual-only"
}

@test "changelog_generate: groups by category" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
| [FIX-101](x.md) | 修复崩溃问题 | ✅ Done |
EOF
  run python3 "$GEN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"### 新功能"* ]]
  [[ "$output" == *"### 稳定性"* ]]
}

@test "changelog_generate: adds [loop] tag for loop stories" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-AUTO-001](x.md) | 新增功能 | ✅ Done |
| [US-FOO-001](x.md) | 新增功能 | ✅ Done |
EOF
  run python3 "$GEN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[loop]"* ]]
}

@test "changelog_generate: flags lint violations" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [FIX-101](x.md) | Phase 5 给 `_foo()` 加 Helper 导致崩溃 | ✅ Done |
EOF
  run python3 "$GEN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"lint:"* ]]
}

@test "changelog_generate: no backlog prints error" {
  run python3 "$GEN"
  [ "$status" -eq 1 ]
  [[ "$output" == *"backlog file not found"* ]]
}

@test "changelog_generate: empty result prints friendly message" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  cat > CHANGELOG.md <<'EOF'
# Changelog
## Unreleased
- 新增一键安装 [loop]
EOF
  run python3 "$GEN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No new ✅ Done stories"* ]]
}

# ─── Write mode ──────────────────────────────────────────────────────────────

@test "changelog_generate --write: creates CHANGELOG.md if missing" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  run python3 "$GEN" --write
  [ "$status" -eq 0 ]
  [ -f CHANGELOG.md ]
  grep -q "新增一键安装" CHANGELOG.md
}

@test "changelog_generate --write: appends to existing Unreleased" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
| [FIX-101](x.md) | 修复崩溃问题 | ✅ Done |
EOF
  cat > CHANGELOG.md <<'EOF'
# Changelog
## Unreleased
- 已有条目 [loop]
## v1.0.0
- old
EOF
  run python3 "$GEN" --write
  [ "$status" -eq 0 ]
  grep -q "已有条目" CHANGELOG.md
  grep -q "新增一键安装" CHANGELOG.md
  grep -q "修复崩溃问题" CHANGELOG.md
}

@test "changelog_generate --write: does not duplicate existing bullets" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  cat > CHANGELOG.md <<'EOF'
# Changelog
## Unreleased
- 新增一键安装 [loop]
## v1.0.0
- old
EOF
  run python3 "$GEN" --write
  [ "$status" -eq 0 ]
  # Should still contain the bullet exactly once
  [ "$(grep -c "新增一键安装" CHANGELOG.md)" -eq 1 ]
}

# ─── Integration with bin/roll ───────────────────────────────────────────────

@test "cmd_changelog generate: dispatcher routes to generate" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  run cmd_changelog generate --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d['stories_drafted'] == 1"
}

@test "cmd_changelog --help: shows generate in usage" {
  run cmd_changelog --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"generate"* ]]
}

@test "cmd_changelog: unknown subcommand shows error" {
  run cmd_changelog foobar
  [ "$status" -eq 1 ]
  [[ "$output" == *"Unknown subcommand"* ]]
}

@test "cmd_changelog: audit is now unknown subcommand (US-CL-008)" {
  run cmd_changelog audit
  [ "$status" -eq 1 ]
  [[ "$output" == *"Unknown subcommand"* ]]
  [[ "$output" == *"generate"* ]]
}

@test "cmd_changelog: default (no args) runs generate (US-CL-008)" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  run cmd_changelog
  [ "$status" -eq 0 ]
  [[ "$output" == *"Unreleased"* ]]
}
