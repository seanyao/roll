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
_detect_agent() {
  if [[ -f ".roll.yaml" ]] && grep -q "^agent:" .roll.yaml 2>/dev/null; then
    grep "^agent:" .roll.yaml | awk '{print $2}' | tr -d '"' | head -1
  elif [[ -f "${HOME}/.roll/config.yaml" ]] && grep -q "primary_agent:" "${HOME}/.roll/config.yaml" 2>/dev/null; then
    grep "primary_agent:" "${HOME}/.roll/config.yaml" | awk '{print $2}' | tr -d '"' | head -1
  else
    echo "claude"
  fi
}

_run_changelog_skill() {
  local skill_file="${REPO_ROOT}/skills/roll-.changelog/SKILL.md"
  [[ -f "$skill_file" ]] || { echo "Warning: roll-.changelog skill not found, skipping."; return; }
  local agent; agent=$(_detect_agent)
  # Strip YAML frontmatter before passing to agent
  local content; content=$(awk 'NR==1 && /^---$/{skip=1;next} skip && /^---$/{skip=0;next} !skip{print}' "$skill_file")
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

# Commit (include CHANGELOG.md if it was updated by cmd_release)
git add package.json bin/roll
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
