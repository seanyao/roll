#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Calculate version: YYYY.MMDD.N (no leading zero on month+day combined)
TODAY=$(date +%Y)
MMDD=$(date +%-m%d)  # e.g. 419 for April 19, 1201 for Dec 1
VERSION_PREFIX="${TODAY}.${MMDD}"

# Find highest N used today
LATEST_N=$(git tag --list "v${VERSION_PREFIX}.*" | sed "s/v${VERSION_PREFIX}\.//" | sort -n | tail -1)
N=$(( ${LATEST_N:-0} + 1 ))
VERSION="${VERSION_PREFIX}.${N}"
TAG="v${VERSION}"

echo "Proposed version: ${VERSION}"
echo ""
read -p "Publish ${TAG}? [y/N] " confirm
[[ "$confirm" == [yY] ]] || { echo "Aborted."; exit 0; }

# ── Sync CHANGELOG.md from BACKLOG via configured agent ──────────────────────
# Source bin/roll for shared helpers (_project_agent, _skill_content).
# main() is guarded by BASH_SOURCE == $0, so sourcing is safe.
_RELEASE_VERSION="${VERSION}"
_RELEASE_TAG="${TAG}"
set +e
source "${REPO_ROOT}/bin/roll" 2>/dev/null  # sets VERSION to current installed version
set -e
VERSION="${_RELEASE_VERSION}"  # restore release version (source clobbers it)
TAG="${_RELEASE_TAG}"
unset _RELEASE_VERSION _RELEASE_TAG

# Shared bypass helper now lives in bin/roll as _agent_bypass_claude_perms
# (sourced above). It splices --dangerously-skip-permissions into claude argv
# so Claude Code 2.1.x's pre-write approval UX doesn't block the non-
# interactive `claude -p` invocations in this script.

_run_changelog_skill() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || { echo "Warning: roll-.changelog skill not found, skipping."; return; }
  local agent; agent=$(_project_agent)
  local content; content=$(_skill_content "$skill_file")
  echo "Syncing CHANGELOG.md via ${agent}..." >&2
  _agent_argv "$agent" plain "$content" || { echo "Error: Unknown agent '${agent}'. Run: roll agent use <name>"; exit 1; }
  _agent_bypass_claude_perms
  "${_AGENT_ARGV[@]}"
}

_run_release_notes_skill() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || { echo "Warning: roll-.changelog skill not found, skipping release notes."; return 1; }
  local agent; agent=$(_project_agent)
  local skill_content; skill_content=$(_skill_content "$skill_file")

  # Extract the just-written changelog section for this version
  local changelog_section
  changelog_section=$(awk "/^## v${VERSION}/{found=1; next} found && /^## /{exit} found{print}" CHANGELOG.md)

  local prompt="${skill_content}

---

## 当前任务：生成 GitHub Release Notes（Section 7）

按照上方 Section 7 的分组规则（自动化流水线 / 可见性 / 稳定性 / 工程和测试 / 新功能 / 约定与导航）
和措辞原则，把下面的 CHANGELOG 条目整理成 Release Notes 格式。

规则：
- 按用户感知分组，每组加 ### 标题
- 每条末尾加 \`[loop]\` / \`[dream]\` 归因标签（无法确定来源则不加）
- 去掉 **Added** / **Fixed** 前缀，分组标题已承担语义分类
- 只输出 Markdown 正文，不要任何额外说明

当前版本（v${VERSION}）的 CHANGELOG 条目：
${changelog_section}"

  echo "Generating release notes via ${agent}..." >&2
  _agent_argv "$agent" plain "$prompt" || { echo "Warning: Unknown agent '${agent}', skipping release notes."; return 1; }
  _agent_bypass_claude_perms
  "${_AGENT_ARGV[@]}"
}

# Update package.json
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '${VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

# Update VERSION in bin/roll
sed -i.bak "s/^VERSION=.*/VERSION=\"${VERSION}\"/" bin/roll && rm bin/roll.bak

# Sync CHANGELOG.md: only run skill if section for this version is missing
if ! grep -q "^## v${VERSION}" CHANGELOG.md 2>/dev/null; then
  _run_changelog_skill
  # Rename ## Unreleased → ## v{VERSION}
  sed -i.bak "s/^## Unreleased$/## v${VERSION}/" CHANGELOG.md && rm CHANGELOG.md.bak
fi

# Generate GitHub Release Notes (Section 7 grouped format) → release_notes.txt
if _run_release_notes_skill > release_notes.txt 2>/dev/null && [ -s release_notes.txt ]; then
  echo "release_notes.txt generated."
else
  # fallback: extract raw section from CHANGELOG.md
  awk "/^## v${VERSION}/{found=1; next} found && /^## /{exit} found && NF{print}" \
    CHANGELOG.md > release_notes.txt || true
fi

# Rewrites docs/features.md as product-level SOT. Reads BACKLOG +
# docs/features/ + current features.md, agent emits the full rewritten file
# to stdout.
_run_features_sync_skill() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || return 1
  local agent="$1"
  local skill_content; skill_content=$(_skill_content "$skill_file")
  local backlog_content; backlog_content=$(<BACKLOG.md)
  local current_features=""
  [[ -f docs/features.md ]] && current_features=$(<docs/features.md)
  local features_dir_listing
  features_dir_listing=$(printf '%s\n' docs/features/*.md \
    | sed 's|^docs/features/||' \
    | grep -vE '(-plan\.md$|^refactor-log\.md$)' || true)
  local prompt="${skill_content}

---

## 当前任务：重写 docs/features.md（Section 8）

按 Section 8 规则把整个 docs/features.md 写出来。只输出 Markdown 正文，无任何额外说明。

当前版本：v${VERSION}

### 当前 docs/features.md：
${current_features}

### 当前 docs/features/ 目录（仅文件名）：
${features_dir_listing}

### 当前 BACKLOG.md：
${backlog_content}"

  _agent_argv "$agent" text "$prompt" || return 1
  _agent_bypass_claude_perms
  "${_AGENT_ARGV[@]}"
}

_release_agent=$(_project_agent)
echo "Rewriting docs/features.md via ${_release_agent}..." >&2
_tmp_features=$(mktemp)
_tmp_features_err=$(mktemp)
if _run_features_sync_skill "$_release_agent" >"$_tmp_features" 2>"$_tmp_features_err" && [ -s "$_tmp_features" ]; then
  if ! cmp -s docs/features.md "$_tmp_features" 2>/dev/null; then
    mv "$_tmp_features" docs/features.md
    echo "docs/features.md updated." >&2
  else
    rm -f "$_tmp_features"
  fi
  rm -f "$_tmp_features_err"
else
  rm -f "$_tmp_features"
  echo "Warning: features sync skipped (skill returned empty)." >&2
  if [ -s "$_tmp_features_err" ]; then
    echo "  agent stderr (first 3 lines):" >&2
    head -3 "$_tmp_features_err" | sed 's/^/    /' >&2
  fi
  rm -f "$_tmp_features_err"
fi

# Stage release artefacts. git add is a no-op for unchanged files, so the
# two doc paths can be staged unconditionally.
git add package.json bin/roll release_notes.txt CHANGELOG.md docs/features.md
git commit -m "[release] ${TAG}"
git tag "${TAG}"
git push && git push --tags

# Publish to npm (unset proxy vars — npm can reach registry.npmjs.org directly)
echo ""
echo "Publishing to npm..."
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
  npm publish --access public

echo ""
echo "✅ Released ${TAG}"
