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

# ── Source bin/roll for shared helpers ───────────────────────────────────────
_RELEASE_VERSION="${VERSION}"
_RELEASE_TAG="${TAG}"
set +e
source "${REPO_ROOT}/bin/roll" 2>/dev/null  # sets VERSION to current installed version
set -e
VERSION="${_RELEASE_VERSION}"  # restore release version (source clobbers it)
TAG="${_RELEASE_TAG}"
unset _RELEASE_VERSION _RELEASE_TAG

# ── Planning-marker enforcement (US-DOC-011 mechanical guard, FIX-051) ───────
# AI-rewritten features.md can silently drop the *(规划中)* marker that flags
# all-Todo Features. Post-process the file mechanically so the rule no longer
# depends on AI compliance.
_enforce_planning_markers() {
  local features="${1:-docs/features.md}"
  local backlog="${2:-BACKLOG.md}"
  [[ -f "$features" && -f "$backlog" ]] || return 0

  local all_todo
  all_todo=$(awk '
    /^### Feature:/ {
      if (name != "" && todo > 0 && done == 0) print name
      name = $0; sub(/^### Feature: */, "", name); todo = 0; done = 0; next
    }
    /✅ Done/ { done++ }
    /📋 Todo|🔨 In Progress/ { todo++ }
    END { if (name != "" && todo > 0 && done == 0) print name }
  ' "$backlog")

  [[ -z "$all_todo" ]] && return 0

  awk -v list="$all_todo" '
    BEGIN {
      n = split(list, arr, "\n")
      for (i = 1; i <= n; i++) if (arr[i] != "") names[arr[i]] = 1
    }
    {
      if ($0 ~ /^- / && $0 !~ /规划中/) {
        for (name in names) {
          if (index($0, "(docs/features/" name ".md)") > 0 || $0 ~ ("^- " name " ")) {
            print $0 " *(规划中)*"
            next
          }
        }
      }
      print
    }
  ' "$features" > "${features}.tmp" && mv "${features}.tmp" "$features"
}

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
  ' BACKLOG.md
}

# ── AI call 1: sync CHANGELOG.md + generate release notes (one call) ─────────
# Sends only SKILL.md sections 1-7 (strips the features.md section 8).
# The agent edits CHANGELOG.md via file tools; its stdout response = release notes.
_run_changelog_and_notes() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || { echo "Warning: roll-.changelog skill not found, skipping." >&2; return 1; }
  local agent; agent=$(_project_agent)

  # Sections 1-7 only — drop Section 8 (features.md rewrite, handled separately)
  local skill_content; skill_content=$(awk '/^## 8\. features\.md/{exit} {print}' "$skill_file")

  local prompt="${skill_content}

---

## 当前任务：更新 CHANGELOG.md + 输出 GitHub Release Notes（一次回复）

**步骤一**：按 Section 1-5 规则将当前版本（v${VERSION}）的新条目补入 CHANGELOG.md
（已有 ## Unreleased 则追加；无则创建；Section 4 规定只写 ## Unreleased，不写版本号）。

**步骤二**：完成步骤一后，按 Section 7 规则将当前 ## Unreleased 的条目整理为
GitHub Release Notes，直接输出 Markdown 正文到 stdout，不含任何额外说明或标题。

当前 CHANGELOG.md（前 100 行）：
$(head -100 CHANGELOG.md 2>/dev/null || true)

当前 BACKLOG.md ✅ Done 条目（最近 40 条）：
$(grep '✅ Done' BACKLOG.md | tail -40)"

  echo "Syncing CHANGELOG.md and generating release notes via ${agent}..." >&2
  _agent_argv "$agent" plain "$prompt" || { echo "Error: Unknown agent '${agent}'." >&2; return 1; }
  _agent_bypass_claude_perms
  "${_AGENT_ARGV[@]}" >/dev/null  # AI edits CHANGELOG.md via file tools; raw stdout discarded
  # Extract release notes from the now-updated CHANGELOG.md (no format drift, no stdout pollution)
  awk '/^## Unreleased/{found=1; next} found && /^## /{exit} found && NF{print}' CHANGELOG.md
}

# ── AI call 2: rewrite docs/features.md (section 8 only + compact BACKLOG) ──
_run_features_sync_skill() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || return 1
  local agent="$1"

  # Section 8 only — features.md rewrite rules
  local skill_content; skill_content=$(awk '/^## 8\. features\.md/{found=1} found{print}' "$skill_file")

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
  if _run_changelog_and_notes > release_notes.txt 2>/dev/null && [ -s release_notes.txt ]; then
    sed -i.bak '/^```/d' release_notes.txt && rm release_notes.txt.bak
    echo "release_notes.txt generated."
    # Promote ## Unreleased → ## v{VERSION} now that changelog is updated
    sed -i.bak "s/^## Unreleased$/## v${VERSION}/" CHANGELOG.md && rm CHANGELOG.md.bak
  else
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

# ── AI call 2: rewrite docs/features.md ──────────────────────────────────────
_release_agent=$(_project_agent)
echo "Rewriting docs/features.md via ${_release_agent}..." >&2
_tmp_features=$(mktemp)
_tmp_features_err=$(mktemp)
if _run_features_sync_skill "$_release_agent" >"$_tmp_features" 2>"$_tmp_features_err" && [ -s "$_tmp_features" ]; then
  # Strip leading/trailing ``` code fences the agent sometimes wraps around
  # the whole document (same defensive strip we apply to release_notes.txt).
  sed -i.bak -e '1{/^```/d;}' -e '${/^```$/d;}' "$_tmp_features" && rm -f "${_tmp_features}.bak"
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

# Mechanical guard for US-DOC-011 planning markers (FIX-051). Runs whether or
# not the AI step actually rewrote the file — covers both new-AI-output and
# pre-existing-content paths.
_enforce_planning_markers docs/features.md BACKLOG.md

# Stage release artefacts. git add is a no-op for unchanged files.
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
