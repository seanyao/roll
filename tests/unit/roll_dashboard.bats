#!/usr/bin/env bats
# Unit tests for: _legacy_home — 自治优先六块布局 (US-AUTO-029)

load helpers

setup() {
  unit_setup_cd
  # Isolate HOME so we control _LOOP_STATE / _LOOP_ALERT lookups.
  _UNIT_ORIG_HOME="$HOME"
  export HOME="$TEST_TMP/home"
  mkdir -p "$HOME"
  # Reload roll path-derived globals using the new HOME.
  _LOOP_STATE="${HOME}/.shared/roll/loop/state.yaml"
  _LOOP_ALERT="${HOME}/.shared/roll/loop/ALERT.md"
  _LOOP_RUNS="${HOME}/.shared/roll/loop/runs.jsonl"
  _LOOP_MUTE_FILE="${HOME}/.shared/roll/mute"
  _SHARED_ROOT="${HOME}/.shared/roll"
  ROLL_CONFIG="${HOME}/.roll/config.yaml"
  mkdir -p "${HOME}/.shared/roll/loop" "${HOME}/.shared/roll/dream" "${HOME}/.roll"
  # Set up a minimal git repo so _dash_git_status can run.
  git init -q .
  git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "init"
  # Minimal BACKLOG so cwd is a "roll-managed project".
  cat > .roll/backlog.md <<'EOF'
# Backlog
| Story | Description | Status |
|-------|-------------|--------|
| [US-DEMO-001](.roll/features/demo.md#us-demo-001) | demo todo | 📋 Todo |
EOF
}

teardown() {
  export HOME="$_UNIT_ORIG_HOME"
  unit_teardown_cd
}

# ─── Block ① Identity ────────────────────────────────────────────────────────

@test "dashboard: identity line shows name + version + agent + git status" {
  local out
  out=$(_legacy_home)
  echo "$out"
  echo "$out" | grep -q "$(basename "$PWD")"
  echo "$out" | grep -q "v${VERSION}"
  echo "$out" | grep -qE "agent.*(claude|kimi|deepseek)"
  echo "$out" | grep -qE "git.*(✓|clean|dirty)"
}

@test "dashboard: identity line marks dirty tree" {
  echo "wip" > untracked.txt
  local out; out=$(_legacy_home)
  echo "$out" | grep -q "dirty"
}

# ─── Block ② AI 自治 ─────────────────────────────────────────────────────────

@test "dashboard: AI 自治 block frames Loop / Dream / Peer" {
  local out; out=$(_legacy_home)
  echo "$out"
  echo "$out" | grep -q "AI 自治"
  echo "$out" | grep -q "Loop"
  echo "$out" | grep -q "Dream"
  echo "$out" | grep -q "Peer"
}

@test "dashboard: defenses row shows TCR / Spar / Auto Review / Sentinel" {
  local out; out=$(_legacy_home)
  echo "$out" | grep -q "TCR"
  echo "$out" | grep -q "Spar"
  echo "$out" | grep -q "Auto Review"
  echo "$out" | grep -q "Sentinel"
}

@test "dashboard: Now line reflects in-progress story from BACKLOG" {
  # Mark a story 🔨 In Progress and confirm dashboard surfaces it.
  cat > .roll/backlog.md <<'EOF'
| Story | Description | Status |
|-------|-------------|--------|
| [US-DEMO-007](.roll/features/demo.md#us-demo-007) | demo wip | 🔨 In Progress |
EOF
  local out; out=$(_legacy_home)
  echo "$out" | grep -q "US-DEMO-007"
}

# ─── Block ③ Pipeline 全景 ──────────────────────────────────────────────────

@test "dashboard: Pipeline line shows five segments with counts" {
  cat > .roll/backlog.md <<'EOF'
| ID | Description | Status |
|----|-------------|--------|
| IDEA-001 | i | 📋 Todo |
| IDEA-002 | i | 📋 Todo |
| FIX-001 | f | 📋 Todo |
| [US-DEMO-1](x.md) | s | 📋 Todo |
| [US-DEMO-2](x.md) | s | 🔨 In Progress |
| REFACTOR-1 | r | 📋 Todo |
EOF
  local out; out=$(_legacy_home)
  echo "$out"
  echo "$out" | grep -qE "Idea[^0-9]*2"
  echo "$out" | grep -qE "Backlog[^0-9]*3"
  echo "$out" | grep -qE "Build[^0-9]*1"
  echo "$out" | grep -q "Verify"
  echo "$out" | grep -q "Release"
}

# ─── Block ④ Current Focus · DoD ────────────────────────────────────────────

@test "dashboard: Focus block renders when Build > 0" {
  cat > .roll/backlog.md <<'EOF'
| [US-DEMO-9](.roll/features/demo.md#us-demo-9) | demo | 🔨 In Progress |
EOF
  local out; out=$(_legacy_home)
  echo "$out" | grep -q "Current Focus"
  echo "$out" | grep -q "AC"
  echo "$out" | grep -q "CI"
  echo "$out" | grep -q "DoD"
}

@test "dashboard: Focus block hidden when no Build" {
  local out; out=$(_legacy_home)
  ! echo "$out" | grep -q "Current Focus"
}

# ─── Block ⑤ Human × AI ─────────────────────────────────────────────────────

@test "dashboard: Human×AI shows 自驱中 when no alerts/proposals/release" {
  local out; out=$(_legacy_home)
  echo "$out" | grep -q "AI 自驱中"
}

@test "dashboard: Human×AI surfaces ALERT count" {
  echo "# ALERT — sample" > "$_LOOP_ALERT"
  local out; out=$(_legacy_home)
  echo "$out" | grep -qE "ALERT.*roll alert"
}

@test "dashboard: Human×AI surfaces PROPOSAL count with .roll/proposals.md hint" {
  # FIX-033 symptom 3: hint must point to .roll/proposals.md (not `roll backlog`,
  # which lists .roll/backlog.md and never surfaces PROPOSALS entries).
  cat > .roll/proposals.md <<'EOF'
## PROPOSAL: foo
status: pending
EOF
  local out; out=$(_legacy_home)
  echo "$out" | grep -qE "PROPOSAL.*PROPOSALS\.md"
  ! echo "$out" | grep -qE "PROPOSAL.*roll backlog"
}

# ─── _dash_release_ready — FIX-033 symptom 2 ────────────────────────────────

@test "_dash_release_ready: false when no tag exists (fresh repo)" {
  mkdir -p .roll/briefs
  cat > .roll/briefs/2026-05-12-99.md <<'EOF'
## 发版就绪
✅ 可发版
EOF
  run _dash_release_ready
  [ "$status" -ne 0 ]
}

@test "_dash_release_ready: false when only docs/chore commits since latest tag" {
  git -c user.email=t@t -c user.name=t tag v0.1.0
  echo "doc" > a.md
  git add a.md
  git -c user.email=t@t -c user.name=t commit -q -m "docs: rewrite changelog"
  echo "chore" > b.txt
  git add b.txt
  git -c user.email=t@t -c user.name=t commit -q -m "chore: bump deps"
  mkdir -p .roll/briefs
  cat > .roll/briefs/2026-05-12-99.md <<'EOF'
## 发版就绪
✅ 可发版
EOF
  run _dash_release_ready
  [ "$status" -ne 0 ]
}

@test "_dash_release_ready: false when zero commits since latest tag" {
  git -c user.email=t@t -c user.name=t tag v0.1.0
  mkdir -p .roll/briefs
  cat > .roll/briefs/2026-05-12-99.md <<'EOF'
## 发版就绪
✅ 可发版
EOF
  run _dash_release_ready
  [ "$status" -ne 0 ]
}

@test "_dash_release_ready: true when feat commit since tag AND brief signals ready" {
  git -c user.email=t@t -c user.name=t tag v0.1.0
  echo "feat" > a.txt
  git add a.txt
  git -c user.email=t@t -c user.name=t commit -q -m "feat: shiny new thing"
  mkdir -p .roll/briefs
  cat > .roll/briefs/2026-05-12-99.md <<'EOF'
## 发版就绪
✅ 可发版
EOF
  run _dash_release_ready
  [ "$status" -eq 0 ]
}

@test "_dash_release_ready: false when feat commit since tag but no ready brief" {
  git -c user.email=t@t -c user.name=t tag v0.1.0
  echo "feat" > a.txt
  git add a.txt
  git -c user.email=t@t -c user.name=t commit -q -m "feat: shiny new thing"
  run _dash_release_ready
  [ "$status" -ne 0 ]
}

# ─── Block ⑥ Schedules & Last Brief ─────────────────────────────────────────

@test "dashboard: shows compact schedules line for three services" {
  local out; out=$(_legacy_home)
  echo "$out" | grep -qE "loop[^A-Za-z0-9]+:[0-9]{2}"
  echo "$out" | grep -qE "dream[^A-Za-z0-9]+[0-9]{2}:[0-9]{2}"
  echo "$out" | grep -qE "brief[^A-Za-z0-9]+[0-9]{2}:[0-9]{2}"
}

@test "dashboard: shows latest brief age + summary line" {
  mkdir -p .roll/briefs
  cat > .roll/briefs/2026-05-12-99.md <<'EOF'
# 简报 sample

> 测试触发

## 发版就绪
✅ 可发版
EOF
  local out; out=$(_legacy_home)
  echo "$out" | grep -q "Brief"
  echo "$out" | grep -q "ago"
}

# ─── Backwards-compat: existing static checks ────────────────────────────────

@test "dashboard: uses _loop_derive_minute and _launchd_svc_state on macOS branch" {
  local body
  body=$(awk '/^_legacy_home\(\)/{p=1} p{print} p && /^}$/{p=0}' "$ROLL_BIN")
  echo "$body" | grep -q "_loop_derive_minute"
  echo "$body" | grep -q "_launchd_svc_state"
}
