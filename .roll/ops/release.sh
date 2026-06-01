#!/usr/bin/env bash
set -euo pipefail

# Lives inside roll-meta (the maintainer-private repo nested at .roll/).
# REPO_ROOT walks up two levels: .roll/ops/release.sh → .roll/ → Roll repo root.
# This keeps cwd inside the public Roll repo so all relative paths
# (package.json, bin/roll, CHANGELOG.md, .roll/backlog.md) resolve unchanged.
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Calculate version prefix: MAJOR.MMDD (no leading zero on month+day combined)
_release_compute_version_prefix() {
  local _repo_root="${1:-$REPO_ROOT}"
  local _major_file="${_repo_root}/.roll/ops/MAJOR_VERSION"
  if ! [ -f "$_major_file" ]; then
    echo "❌ Release aborted: ${_major_file} not found." >&2
    echo "   Create it with a single integer (e.g. '2')." >&2
    return 1
  fi
  local _major; _major=$(cat "$_major_file")
  if ! echo "$_major" | grep -qE '^[0-9]+$'; then
    echo "❌ Release aborted: ${_major_file} must contain a single integer." >&2
    return 1
  fi
  local _mmdd; _mmdd=$(date +%-m%d)
  VERSION_PREFIX="${_major}.${_mmdd}"
}

# Guard: when sourced, only load functions; do not run the release flow.
if [ "${BASH_SOURCE[0]}" = "$0" ] || [ -z "${BASH_SOURCE[0]}" ]; then
  cd "$REPO_ROOT"
  _release_compute_version_prefix || exit 1

# Find highest N used today.
# Query the remote — a tag created on another machine and never fetched would
# be invisible to a local `git tag --list`, causing N to repeat and the npm
# publish to fail on duplicate version.
#
# `grep || true` is required: on the first release of a new day there are no
# matching tags, grep exits 1, and `set -euo pipefail` would kill the script.
LATEST_N=$(
  {
    git tag --list "v${VERSION_PREFIX}.*"
    git ls-remote --tags origin "refs/tags/v${VERSION_PREFIX}.*" 2>/dev/null \
      | awk '{print $2}' | sed 's|refs/tags/||'
  } \
  | sed "s/v${VERSION_PREFIX}\.//" \
  | { grep -E '^[0-9]+$' || true; } \
  | sort -n | tail -1
)
N=$(( ${LATEST_N:-0} + 1 ))
VERSION="${VERSION_PREFIX}.${N}"
TAG="v${VERSION}"

echo "Proposed version: ${VERSION}"
echo ""
read -p "Publish ${TAG}? [y/N] " confirm
[[ "$confirm" == [yY] ]] || { echo "Aborted."; exit 0; }

# ── Pre-flight: npm auth ─────────────────────────────────────────────────────
# Fail before the AI calls and the local commit/tag if we can't publish.
# Without this, a 401 on `npm publish` only surfaces *after* git push + meta
# push, leaving a public tag that points at a version not on the registry.
if ! env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
     npm whoami >/dev/null 2>&1; then
  echo "❌ Release aborted: npm is not logged in (npm whoami returned 401)." >&2
  echo "   Run \`npm login\` (browser + 2FA), then re-run roll-release." >&2
  exit 1
fi

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

# NOTE (release de-AI'd): release.sh makes NO AI calls. The CHANGELOG is written
# at merge time by $roll-.changelog; release only extracts this version's section
# verbatim (below) and promotes the heading. features.md likewise is maintained by
# that skill (it's "another expression of the changelog"), not regenerated here.

# Update package.json
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '${VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

# Update VERSION in bin/roll
sed -i.bak "s/^VERSION=.*/VERSION=\"${VERSION}\"/" bin/roll && rm bin/roll.bak

# ── CHANGELOG → GitHub Release body (deterministic, NO AI) ───────────────────
# Roll has no separate "release notes": the body IS this version's changelog
# section, written at merge time by $roll-.changelog. Release just extracts it
# verbatim and promotes the heading — no inline AI, no waiting.
if grep -q "^## v${VERSION}" CHANGELOG.md 2>/dev/null; then
  # Re-run after a partial release: this version is already promoted — re-extract.
  awk "/^## v${VERSION}/{found=1; next} found && /^## /{exit} found && NF{print}" \
    CHANGELOG.md > release_notes.txt || true
else
  awk "/^## Unreleased/{found=1; next} found && /^## /{exit} found && NF{print}" \
    CHANGELOG.md > release_notes.txt || true
  if [ ! -s release_notes.txt ]; then
    echo "❌ Release aborted: CHANGELOG.md has no content under ## Unreleased." >&2
    echo "   Write this version's notes under ## Unreleased (via \$roll-.changelog), then re-run." >&2
    rm -f release_notes.txt
    exit 1
  fi
  # Promote ## Unreleased → ## v{VERSION}.
  sed -i.bak "s/^## Unreleased$/## v${VERSION}/" CHANGELOG.md && rm CHANGELOG.md.bak
fi

# NOTE: .roll/features.md is NOT regenerated here. It is "another expression of
# the changelog" and is maintained by the $roll-.changelog skill at changelog-
# update (merge) time — not at release. Release no longer makes any AI call.

# REFACTOR-042: mechanical safety net for features.md catalog completeness.
# AI rewrite is prompt-driven and can silently drop Features when BACKLOG
# grows. Enumerate every `### Feature: <name>` in BACKLOG that has ≥1 ✅ Done
# story, then assert each name appears at least once in features.md.
# Warn-only (does not abort release) — release continues, but operator sees
# the gap immediately and can re-run / patch.
_enforce_features_catalog() {
  [ -f .roll/backlog.md ] && [ -f .roll/features.md ] || return 0
  local missing
  missing=$(awk '
    /^### Feature:/{
      if (feat != "" && done > 0) print feat
      gsub(/^### Feature: /,""); feat=$0; done=0
    }
    /✅ Done/{ done++ }
    END{ if (feat != "" && done > 0) print feat }
  ' .roll/backlog.md | while IFS= read -r name; do
    [ -n "$name" ] || continue
    grep -qE "(^|[[:space:]/])${name}([[:space:]/.)]|$)" .roll/features.md \
      || printf '%s\n' "$name"
  done)
  if [ -n "$missing" ]; then
    echo "Warning: features.md catalog missing Features with ≥1 Done story:" >&2
    printf '  %s\n' $missing >&2
    echo "  (REFACTOR-042 safety net — AI rewrite missed these; patch manually before tagging.)" >&2
  fi
}
_enforce_features_catalog

# Stage release artefacts in outer repo. git add is a no-op for unchanged files.
# .roll/ is the nested private repo (roll-meta, gitignored here) — its
# features.md is committed separately below to avoid `git add` failing on an
# ignored path under set -e.
git add package.json bin/roll release_notes.txt CHANGELOG.md

# Idempotent: skip commit when nothing staged (re-running after a prior
# partial release where these files are already committed).
if ! git diff --cached --quiet; then
  # --no-verify: the release commit stages version-bump code (package.json,
  # bin/roll) plus AI-generated changelog, and the AI changelog/features steps
  # above take minutes — so the repo's TCR pre-commit gate (proof must be <60s
  # old) can NEVER be satisfied here. Tests are the operator's pre-flight
  # responsibility, and CI re-runs the full suite on the pushed tag/main.
  git commit --no-verify -m "[release] ${TAG}"
else
  echo "Outer repo already at ${TAG} — skipping commit."
fi

# Idempotent: only create tag if it doesn't exist locally yet.
if ! git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  git tag "${TAG}"
fi

# ── npm publish FIRST (before any remote push) ───────────────────────────────
# If publish fails we still hold an unpushed local commit + tag — fix the
# problem (auth, network) and re-run; nothing public has diverged.
# Idempotent: skip when the version is already on the registry.
echo ""
if npm view "@seanyao/roll@${VERSION}" version 2>/dev/null | grep -qx "${VERSION}"; then
  echo "v${VERSION} already published to npm — skipping."
else
  echo "Publishing to npm..."
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
    npm publish --access public
fi

# ── git push (only after npm succeeded) ──────────────────────────────────────
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

echo ""
echo "✅ Released ${TAG}"
fi
