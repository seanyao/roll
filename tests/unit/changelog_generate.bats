#!/usr/bin/env bats
# US-CL-006+007: roll changelog generate — deterministic draft from backlog Done stories + merged PR gap detection.
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

@test "changelog_generate: cleans depends-on tags" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增功能 `depends-on:US-FOO-002` | ✅ Done |
| [FIX-101](x.md) | 修复问题 | ✅ Done |
EOF
  run python3 "$GEN" --json
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "新增功能"
  ! echo "$output" | grep -q "depends-on"
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
  # FIX-178: force AI styling to no-op (unknown agent → deterministic fallback)
  # so the dispatch test never makes a real agent call.
  echo 'agent: __none__' > .roll.yaml
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  run cmd_changelog
  [ "$status" -eq 0 ]
  [[ "$output" == *"Unreleased"* ]]
}

@test "FIX-178: generate AI-styles the draft via the configured agent" {
  mkdir -p .roll
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  # Stub the default configured agent (claude) with a fake that emits a styled draft.
  local fake="${TEST_TMP}/fakebin"; mkdir -p "$fake"
  printf '%s\n' '#!/usr/bin/env bash' \
    'printf "## Unreleased\n\n### 新功能\n\n- **AI润色标题(US-FOO-001)** — 说明\n"' > "$fake/claude"
  chmod +x "$fake/claude"
  PATH="$fake:$PATH" run cmd_changelog generate
  [ "$status" -eq 0 ]
  [[ "$output" == *"AI润色标题"* ]]
}

@test "FIX-178: generate falls back to deterministic draft when agent unavailable" {
  mkdir -p .roll
  echo 'agent: __none__' > .roll.yaml
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  run cmd_changelog generate
  [ "$status" -eq 0 ]
  [[ "$output" == *"新增一键安装"* ]]
}

# ─── US-CL-007: merged PR gap detection ──────────────────────────────────────

_setup_git_repo() {
  git init
  git config user.email "test@roll.local"
  git config user.name "Test"
  echo "init" > file.txt
  git add file.txt
  git commit -m "init"
  git tag v1.0.0
}

_gh_mock_dir() {
  local d="${TEST_TMP}/fake_gh"
  mkdir -p "$d"
  cat > "$d/gh" <<'SCRIPT'
#!/usr/bin/env bash
# Mock gh
if [[ "$1" == "--version" ]]; then
  echo "gh version 2.0.0"
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" && "$4" == "--json" && "$5" == "title" ]]; then
  num="$3"
  echo "{\"title\": \"PR title $num\"}"
  exit 0
fi
exit 1
SCRIPT
  chmod +x "$d/gh"
  echo "$d"
}

@test "FIX-179: uncarded merged PRs fold into the draft, no 待确认 warning block" {
  mkdir -p .roll
  _setup_git_repo
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  # Simulate a merged PR after the tag (no backlog card)
  echo "change" >> file.txt
  git add file.txt
  git commit -m "Fix something (#123)"

  fake_gh="$(_gh_mock_dir)"
  # bats merges stderr into $output; the uncarded notice (with #123) appears there.
  PATH="$fake_gh:$PATH" run python3 "$GEN"
  [ "$status" -eq 0 ]
  # The maintainer-only warning block must NEVER be emitted (it leaked into v2.603.1).
  ! [[ "$output" == *"待确认"* ]]
  ! [[ "$output" == *"请确认"* ]]
  # The uncarded PR is still surfaced (folded bullet idref / stderr notice).
  [[ "$output" == *"#123"* ]]
}

@test "changelog_generate: skips merged PR when story is Done in backlog" {
  mkdir -p .roll
  _setup_git_repo
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [FIX-101](x.md) | 修复崩溃问题 | ✅ Done |
EOF
  echo "change" >> file.txt
  git add file.txt
  git commit -m "Fix: FIX-101 repair crash (#123)"

  fake_gh="$(_gh_mock_dir)"
  PATH="$fake_gh:$PATH" run python3 "$GEN"
  [ "$status" -eq 0 ]
  ! [[ "$output" == *"#123"* ]]
}

@test "changelog_generate: skips merged PR already in CHANGELOG" {
  mkdir -p .roll
  _setup_git_repo
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  cat > CHANGELOG.md <<'EOF'
# Changelog
## Unreleased
- PR title #123
EOF
  echo "change" >> file.txt
  git add file.txt
  git commit -m "Fix something (#123)"

  fake_gh="$(_gh_mock_dir)"
  PATH="$fake_gh:$PATH" run python3 "$GEN"
  [ "$status" -eq 0 ]
  ! [[ "$output" == *"#123"* ]]
}

@test "changelog_generate: offline mode skips uncarded block gracefully" {
  mkdir -p .roll
  _setup_git_repo
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  echo "change" >> file.txt
  git add file.txt
  # FIX-177: commit references the story so release-aware filtering (since last
  # tag) drafts it; an unreferenced story would be treated as already-released.
  git commit -m "US-FOO-001: 新增一键安装 (#123)"

  # Ensure gh is NOT available by creating a fake gh that always fails
  fake_gh="${TEST_TMP}/fake_gh_offline"
  mkdir -p "$fake_gh"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 127' > "$fake_gh/gh"
  chmod +x "$fake_gh/gh"
  PATH="$fake_gh:$PATH" run python3 "$GEN"
  [ "$status" -eq 0 ]
  # Should still produce the backlog-driven part
  [[ "$output" == *"新增一键安装"* ]]
  # Should NOT contain the warning block
  ! [[ "$output" == *"待确认"* ]]
}

@test "FIX-177: release-aware draft excludes stories not committed since last tag" {
  mkdir -p .roll
  _setup_git_repo
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-OLD-001](x.md) | 老功能早已发布 | ✅ Done |
| [US-NEW-002](x.md) | 新功能本次发布 | ✅ Done |
EOF
  echo c >> file.txt
  git add file.txt
  git commit -m "US-NEW-002: 新功能本次发布 (#200)"
  run python3 "$GEN"
  [ "$status" -eq 0 ]
  # since-tag commit names US-NEW-002 → drafted
  [[ "$output" == *"新功能本次发布"* ]]
  # US-OLD-001 not referenced post-tag → treated as already released, excluded
  ! [[ "$output" == *"老功能早已发布"* ]]
}

@test "changelog_generate --json: includes uncarded_merged array" {
  mkdir -p .roll
  _setup_git_repo
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
| [US-FOO-001](x.md) | 新增一键安装 | ✅ Done |
EOF
  echo "change" >> file.txt
  git add file.txt
  git commit -m "Fix something (#123)"

  fake_gh="$(_gh_mock_dir)"
  PATH="$fake_gh:$PATH" run python3 "$GEN" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys, json; d=json.load(sys.stdin); assert len(d.get('uncarded_merged', [])) == 1; assert d['uncarded_merged'][0]['pr'] == '123'"
}
