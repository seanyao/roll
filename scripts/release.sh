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

# Auto-sync CHANGELOG.md from BACKLOG if stale since last tag
LAST_TAG=$(git tag --sort=-version:refname | grep "^v" | head -1)
CHANGELOG_DIRTY=false
if [ -n "$LAST_TAG" ] && ! git diff "${LAST_TAG}..HEAD" --name-only | grep -q "CHANGELOG.md"; then
  echo ""
  echo "CHANGELOG.md not updated since ${LAST_TAG}, syncing from BACKLOG..."
  if command -v claude &>/dev/null; then
    claude -p 'Update CHANGELOG.md by running $roll-.changelog — extract completed BACKLOG items and append to CHANGELOG.md. Do NOT git commit or push, just update the file.'
    CHANGELOG_DIRTY=true
  else
    echo "Error: claude CLI not found. Cannot sync CHANGELOG.md — install Claude Code and retry."
    exit 1
  fi
fi

# Update package.json
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '${VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

# Update VERSION in bin/roll
sed -i.bak "s/^VERSION=.*/VERSION=\"${VERSION}\"/" bin/roll && rm bin/roll.bak

# Commit (include CHANGELOG.md if it was updated)
git add package.json bin/roll
if [ "$CHANGELOG_DIRTY" = true ] && [ -n "$(git diff HEAD -- CHANGELOG.md)" ]; then
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
