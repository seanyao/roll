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

_run_changelog_skill() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || { echo "Warning: roll-.changelog skill not found, skipping."; return; }
  local agent; agent=$(_project_agent)
  local content; content=$(_skill_content "$skill_file")
  echo "Syncing CHANGELOG.md via ${agent}..."
  case "$agent" in
    claude)   claude -p "$content" ;;
    kimi)     kimi --quiet -p "$content" ;;
    deepseek) deepseek "$content" ;;
    pi)       pi -p "$content" ;;
    codex)    codex exec "$content" ;;
    opencode) opencode run "$content" ;;
    *) echo "Error: Unknown agent '${agent}'. Run: roll agent use <name>"; exit 1 ;;
  esac
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

  echo "Generating release notes via ${agent}..."
  case "$agent" in
    claude)   claude -p "$prompt" ;;
    kimi)     kimi --quiet -p "$prompt" ;;
    deepseek) deepseek "$prompt" ;;
    pi)       pi -p "$prompt" ;;
    codex)    codex exec "$prompt" ;;
    opencode) opencode run "$prompt" ;;
    *) echo "Warning: Unknown agent '${agent}', skipping release notes."; return 1 ;;
  esac
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

# Commit (include CHANGELOG.md and release_notes.txt if updated)
git add package.json bin/roll release_notes.txt
if [ -n "$(git diff HEAD -- CHANGELOG.md)" ]; then
  git add CHANGELOG.md
fi
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
