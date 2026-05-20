#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Calculate version: YYYY.MMDD.N (no leading zero on month+day combined)
TODAY=$(date +%Y)
MMDD=$(date +%-m%d)  # e.g. 419 for April 19, 1201 for Dec 1
VERSION_PREFIX="${TODAY}.${MMDD}"

# Find highest N used today.
# Query the remote — a tag created on another machine and never fetched would
# be invisible to a local `git tag --list`, causing N to repeat and the npm
# publish to fail on duplicate version.
LATEST_N=$(
  {
    git tag --list "v${VERSION_PREFIX}.*"
    git ls-remote --tags origin "refs/tags/v${VERSION_PREFIX}.*" 2>/dev/null \
      | awk '{print $2}' | sed 's|refs/tags/||'
  } \
  | sed "s/v${VERSION_PREFIX}\.//" \
  | grep -E '^[0-9]+$' \
  | sort -n | tail -1
)
N=$(( ${LATEST_N:-0} + 1 ))
VERSION="${VERSION_PREFIX}.${N}"
TAG="v${VERSION}"

echo "Proposed version: ${VERSION}"
echo ""
read -p "Publish ${TAG}? [y/N] " confirm
[[ "$confirm" == [yY] ]] || { echo "Aborted."; exit 0; }

# ── Source bin/roll for shared helpers ───────────────────────────────────────
_RELEASE_VERSION="${VERSION}"
_RELEASE_TAG="${TAG}"
set +e
source "${REPO_ROOT}/bin/roll" 2>/dev/null  # sets VERSION to current installed version
set -e
VERSION="${_RELEASE_VERSION}"  # restore release version (source clobbers it)
TAG="${_RELEASE_TAG}"
unset _RELEASE_VERSION _RELEASE_TAG

# ── Compact BACKLOG summary (~2KB vs 36KB full file) ─────────────────────────
# Emits Epic > Feature hierarchy with done/todo counts per feature.
_backlog_summary() {
  awk '
    /^## Epic:/{
      gsub(/^## Epic: /,""); epic=$0
    }
    /^### Feature:/{
      if (feat != "") printf "  Feature: %s — %d Done, %d Todo\n", feat, done, todo
      gsub(/^### Feature: /,""); feat=$0; done=0; todo=0
      if (epic != last_epic) { printf "Epic: %s\n", epic; last_epic=epic }
    }
    /✅ Done/{ done++ }
    /📋 Todo/{ todo++ }
    /🔨 In Progress/{ todo++ }
    END{ if (feat != "") printf "  Feature: %s — %d Done, %d Todo\n", feat, done, todo }
  ' .roll/backlog.md
}

# ── AI call 1: sync CHANGELOG.md + generate release notes (one call) ─────────
# Sends only SKILL.md sections 1-7 (strips the features.md section 8).
# The agent edits CHANGELOG.md via file tools; its stdout response = release notes.
_run_changelog_and_notes() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || { echo "Warning: roll-.changelog skill not found, skipping." >&2; return 1; }
  local agent; agent=$(_project_agent)

  # Sections 1-7 only — drop SKILL.md YAML frontmatter (claude 2.1.144+ parses
  # leading `---` as a CLI long-option and errors out) and drop Section 8
  # (features.md rewrite, handled separately by _run_features_sync_skill).
  local skill_content; skill_content=$(_skill_content "$skill_file" | awk '/^## 8\. features\.md/{exit} {print}')

  local prompt="${skill_content}

---

## 当前任务：更新 CHANGELOG.md + 输出 GitHub Release Notes（一次回复）

**步骤一**：按 Section 1-5 规则将当前版本（v${VERSION}）的新条目补入 CHANGELOG.md
（已有 ## Unreleased 则追加；无则创建；Section 4 规定只写 ## Unreleased，不写版本号）。

**步骤二**：完成步骤一后，按 Section 7 规则将当前 ## Unreleased 的条目整理为
GitHub Release Notes，直接输出 Markdown 正文到 stdout，不含任何额外说明或标题。

当前 CHANGELOG.md（前 100 行）：
$(head -100 CHANGELOG.md 2>/dev/null || true)

当前 .roll/backlog.md ✅ Done 条目（最近 40 条）：
$(grep '✅ Done' .roll/backlog.md | tail -40)"

  echo "Syncing CHANGELOG.md and generating release notes via ${agent}..." >&2
  _agent_argv "$agent" plain "$prompt" || { echo "Error: Unknown agent '${agent}'." >&2; return 1; }
  _agent_bypass_claude_perms
  "${_AGENT_ARGV[@]}" >/dev/null  # AI edits CHANGELOG.md via file tools; raw stdout discarded
  # Extract release notes from the now-updated CHANGELOG.md (no format drift, no stdout pollution)
  awk '/^## Unreleased/{found=1; next} found && /^## /{exit} found && NF{print}' CHANGELOG.md
}

# ── AI call 2: rewrite .roll/features.md (section 8 only + compact BACKLOG) ──
_run_features_sync_skill() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || return 1
  local agent="$1"

  # Section 8 only — features.md rewrite rules. Strip frontmatter via
  # _skill_content for consistency (Section 8 doesn't start at line 1 so the
  # leading-`---` claude-CLI hazard doesn't apply here, but keep it uniform).
  local skill_content; skill_content=$(_skill_content "$skill_file" | awk '/^## 8\. features\.md/{found=1} found{print}')

  local current_features=""
  [[ -f .roll/features.md ]] && current_features=$(<.roll/features.md)
  local features_dir_listing
  features_dir_listing=$(find .roll/features -mindepth 2 -name '*.md' 2>/dev/null \
    | sed 's|^.roll/features/||' \
    | grep -vE '(-plan\.md$|/refactor-log\.md$)' \
    | sort || true)

  local prompt="${skill_content}

---

## 当前任务：重写 .roll/features.md（Section 8）

按 Section 8 规则把整个 .roll/features.md 写出来。只输出 Markdown 正文，无任何额外说明。

当前版本：v${VERSION}

### 当前 .roll/features.md：
${current_features}

### 当前 .roll/features/ 目录（仅文件名）：
${features_dir_listing}

### 当前 BACKLOG 结构摘要（Epic / Feature / 完成度）：
$(_backlog_summary)"

  _agent_argv "$agent" text "$prompt" || return 1
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

# ── AI call 1: sync CHANGELOG + generate release notes (one combined call) ───
if ! grep -q "^## v${VERSION}" CHANGELOG.md 2>/dev/null; then
  _tmp_changelog_err=$(mktemp)
  if _run_changelog_and_notes > release_notes.txt 2>"$_tmp_changelog_err" && [ -s release_notes.txt ]; then
    sed -i.bak '/^```/d' release_notes.txt && rm release_notes.txt.bak
    echo "release_notes.txt generated."
    rm -f "$_tmp_changelog_err"
    # Promote ## Unreleased → ## v{VERSION} now that changelog is updated
    sed -i.bak "s/^## Unreleased$/## v${VERSION}/" CHANGELOG.md && rm CHANGELOG.md.bak
  else
    if [ -s "$_tmp_changelog_err" ]; then
      echo "  agent stderr (first 5 lines):" >&2
      head -5 "$_tmp_changelog_err" | sed 's/^/    /' >&2
    fi
    rm -f "$_tmp_changelog_err"
    # Fallback: extract raw section from existing ## Unreleased.
    # If no Unreleased section exists, abort — releasing without real notes
    # causes the GitHub Actions same-day-merge step to snowball prior bodies.
    awk "/^## Unreleased/{found=1; next} found && /^## /{exit} found && NF{print}" \
      CHANGELOG.md > release_notes.txt || true
    if [ ! -s release_notes.txt ]; then
      echo "❌ Release aborted: AI changelog step failed and CHANGELOG.md has no ## Unreleased section." >&2
      echo "   Add a ## Unreleased block with this version's notes, or rerun when the agent is available." >&2
      rm -f release_notes.txt
      exit 1
    fi
    sed -i.bak "s/^## Unreleased$/## v${VERSION}/" CHANGELOG.md && rm CHANGELOG.md.bak
  fi
else
  # Changelog already has this version — generate release notes from it
  awk "/^## v${VERSION}/{found=1; next} found && /^## /{exit} found && NF{print}" \
    CHANGELOG.md > release_notes.txt || true
fi

# ── AI call 2: rewrite .roll/features.md ──────────────────────────────────────
_release_agent=$(_project_agent)
echo "Rewriting .roll/features.md via ${_release_agent}..." >&2
_tmp_features=$(mktemp)
_tmp_features_err=$(mktemp)
if _run_features_sync_skill "$_release_agent" >"$_tmp_features" 2>"$_tmp_features_err" && [ -s "$_tmp_features" ]; then
  # Strip leading/trailing ``` code fences the agent sometimes wraps around
  # the whole document (same defensive strip we apply to release_notes.txt).
  sed -i.bak -e '1{/^```/d;}' -e '${/^```$/d;}' "$_tmp_features" && rm -f "${_tmp_features}.bak"
  if ! cmp -s .roll/features.md "$_tmp_features" 2>/dev/null; then
    mv "$_tmp_features" .roll/features.md
    echo ".roll/features.md updated." >&2
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

# Stage release artefacts in outer repo. git add is a no-op for unchanged files.
# .roll/ is the nested private repo (roll-meta, gitignored here) — its
# features.md is committed separately below to avoid `git add` failing on an
# ignored path under set -e.
git add package.json bin/roll release_notes.txt CHANGELOG.md

# Idempotent: skip commit when nothing staged (re-running after a prior
# partial release where these files are already committed).
if ! git diff --cached --quiet; then
  git commit -m "[release] ${TAG}"
else
  echo "Outer repo already at ${TAG} — skipping commit."
fi

# Idempotent: only create tag if it doesn't exist locally yet.
if ! git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  git tag "${TAG}"
fi

# push is naturally idempotent; --tags only sends new tags.
git push
git push --tags

# Sync .roll/features.md into the nested roll-meta repo (best-effort, idempotent).
if [ -d .roll/.git ] && [ -f .roll/features.md ]; then
  (
    cd .roll
    git add features.md
    if ! git diff --cached --quiet; then
      git commit -m "[release] ${TAG}"
      git push
    fi
  ) || echo "Warning: .roll/features.md sync to roll-meta failed — push manually from .roll/." >&2
fi

# Publish to npm — idempotent. Skip when the version is already on the
# registry (re-running after a prior partial release that already published).
echo ""
if npm view "@seanyao/roll@${VERSION}" version 2>/dev/null | grep -qx "${VERSION}"; then
  echo "v${VERSION} already published to npm — skipping."
else
  echo "Publishing to npm..."
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
    npm publish --access public
fi

echo ""
echo "✅ Released ${TAG}"
