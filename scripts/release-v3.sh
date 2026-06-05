#!/usr/bin/env bash
# release-v3.sh — the v3.0.0 cutover + release, as one resumable script.
#
# What it does (each phase confirms before irreversible actions):
#   P0  preflight   gh/npm auth, clean tree, branch sync, TS gate, bundle smoke
#   P1  push        push v3 to origin
#   P2  swap        GitHub branch rename: main→v2, v3→main; default branch=main
#   P3  protect     branch protection on new main (PR + required check: test-ts)
#   P4  remap       re-point the local checkouts/worktrees at the new names
#   P5  tag         tag v3.0.0 on new main → release.yml creates the GitHub Release
#   P6  npm         npm publish (interactive 2FA; prepack builds the bundle)
#   P7  meta        roll-meta swap: main→v2, v3→main (live backlog becomes main)
#   P8  smoke       release visible, npm version, installed-CLI sanity
#
# Usage:
#   bash scripts/release-v3.sh            # interactive, confirms each phase
#   bash scripts/release-v3.sh --dry-run  # print the plan, change nothing
#   bash scripts/release-v3.sh --yes      # no prompts (owner knows what they're doing)
#
# Rollback: reverse renames (main→v3, v2→main) + `gh release delete v3.0.0`
# + `npm deprecate @seanyao/roll@3.0.0 "use 2.x"`. bash v2 is double-anchored
# (branch v2 + tag v2-freeze-2026-06-04) — nothing is ever lost.
set -euo pipefail

REPO="seanyao/roll"
META_REPO="seanyao/roll-meta"
TAG="v3.0.0"
ROLL_DIR="${ROLL_DIR:-$HOME/Workspace/roll}"          # checkout on old main
V3_WT="${V3_WT:-$HOME/Workspace/roll-v3}"             # worktree on v3
META_DIR="$ROLL_DIR/.roll"                            # roll-meta checkout (old main)
META_V3_WT="${META_V3_WT:-$HOME/Workspace/roll-meta-v3}"

DRY=0; YES=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; --yes) YES=1 ;; esac; done

say()  { printf '\n\033[1;35m[release]\033[0m %s\n' "$*"; }
note() { printf '  \033[2m%s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m[release] ABORT:\033[0m %s\n' "$*" >&2; exit 1; }

run() { # run "description" cmd args...
  local desc="$1"; shift
  if [ "$DRY" -eq 1 ]; then printf '  \033[2mDRY:\033[0m %s\n        $ %s\n' "$desc" "$*"; return 0; fi
  printf '  → %s\n' "$desc"
  "$@"
}

confirm() {
  [ "$DRY" -eq 1 ] && return 0
  [ "$YES" -eq 1 ] && return 0
  printf '\033[1;33m  继续? [y/N]\033[0m '
  read -r ans; [ "$ans" = "y" ] || die "user declined"
}

# ── P0 preflight ──────────────────────────────────────────────────────────────
say "P0 preflight"
command -v gh  >/dev/null || die "gh not installed"
command -v npm >/dev/null || die "npm not installed"
gh auth status >/dev/null 2>&1 || die "gh not authenticated"
cd "$V3_WT"
[ "$(git rev-parse --abbrev-ref HEAD)" = "v3" ] || [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] \
  || die "v3 worktree is on $(git rev-parse --abbrev-ref HEAD)"
[ -z "$(git status --porcelain)" ] || die "v3 worktree not clean"
if [ "$DRY" -eq 0 ]; then
  npm whoami >/dev/null 2>&1 || die "npm not logged in — run: npm login"
  note "npm user: $(npm whoami)"
  say "P0.1 TS gate（全套测试 + proof）"
  bash scripts/test-ts.sh
  say "P0.2 bundle smoke"
  pnpm bundle >/dev/null
  out=$(node dist/roll.mjs version)
  note "dist/roll.mjs → $out"
  case "$out" in *3.0.0*) : ;; *) die "bundle version mismatch: $out" ;; esac
else
  note "DRY: would run scripts/test-ts.sh + pnpm bundle + version smoke"
fi

# ── P1 push v3 ────────────────────────────────────────────────────────────────
say "P1 push v3 → origin"
run "git push origin v3" git -C "$V3_WT" push origin v3

# ── P2 branch swap on GitHub ──────────────────────────────────────────────────
say "P2 分支对调：main→v2，v3→main（GitHub rename 自动迁 redirect/PR/保护规则）"
default_branch=$(gh api "repos/$REPO" --jq .default_branch 2>/dev/null || echo "?")
note "current default branch: $default_branch"
if [ "$default_branch" = "main" ]; then
  if git -C "$V3_WT" ls-remote --exit-code origin refs/heads/v2 >/dev/null 2>&1; then
    note "v2 branch already exists — skip rename main→v2?"
    die "remote state unexpected: both main(default) and v2 exist — inspect manually"
  fi
  confirm
  run "rename main → v2"  gh api -X POST "repos/$REPO/branches/main/rename" -f new_name=v2
  run "rename v3 → main"  gh api -X POST "repos/$REPO/branches/v3/rename"  -f new_name=main
  run "set default branch = main" gh repo edit "$REPO" --default-branch main
elif [ "$default_branch" = "v2" ] || gh api "repos/$REPO/branches/main" --jq .name 2>/dev/null | grep -q main; then
  note "swap appears already done (default=$default_branch) — skipping P2"
else
  die "unexpected default branch: $default_branch"
fi

# ── P3 protect new main ───────────────────────────────────────────────────────
say "P3 新 main 分支保护（require PR + required check: test-ts）"
confirm
if [ "$DRY" -eq 1 ]; then
  note "DRY: PUT repos/$REPO/branches/main/protection (checks=[test-ts], PR required)"
else
  printf '%s' '{
    "required_status_checks": {"strict": false, "contexts": ["test-ts"]},
    "enforce_admins": false,
    "required_pull_request_reviews": {"required_approving_review_count": 0},
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false
  }' | gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null
  note "protection set"
fi

# ── P4 local remap ────────────────────────────────────────────────────────────
say "P4 本地 checkout 重映射"
confirm
# v3 worktree: local v3 → main, track origin/main
if [ "$(git -C "$V3_WT" rev-parse --abbrev-ref HEAD)" = "v3" ]; then
  run "v3 worktree: rename local branch v3→main" git -C "$V3_WT" branch -m v3 main
fi
run "fetch --prune (worktree)" git -C "$V3_WT" fetch origin --prune
run "track origin/main" git -C "$V3_WT" branch -u origin/main main || true
# main checkout (old v2): rename local main → v2
if [ -d "$ROLL_DIR/.git" ] && [ "$(git -C "$ROLL_DIR" rev-parse --abbrev-ref HEAD)" = "main" ]; then
  run "old checkout: rename local branch main→v2" git -C "$ROLL_DIR" branch -m main v2
  run "fetch --prune (old checkout)" git -C "$ROLL_DIR" fetch origin --prune
  run "track origin/v2" git -C "$ROLL_DIR" branch -u origin/v2 v2 || true
fi
run "remote set-head" git -C "$V3_WT" remote set-head origin -a

# ── P5 tag v3.0.0 ─────────────────────────────────────────────────────────────
say "P5 tag $TAG → push（触发 release.yml 发 GitHub Release）"
confirm
if git -C "$V3_WT" rev-parse "$TAG" >/dev/null 2>&1; then
  note "tag exists locally — skipping create"
else
  run "create tag" git -C "$V3_WT" tag "$TAG"
fi
run "push tag" git -C "$V3_WT" push origin "$TAG"

# ── P6 npm publish ────────────────────────────────────────────────────────────
say "P6 npm publish（prepack 自动 build+bundle；可能要 2FA OTP）"
confirm
run "npm publish --access public" npm publish --access public

# ── P7 roll-meta swap ─────────────────────────────────────────────────────────
say "P7 roll-meta 对调：main→v2，v3→main（live backlog 成为 main）"
confirm
meta_default=$(gh api "repos/$META_REPO" --jq .default_branch 2>/dev/null || echo "?")
if [ "$meta_default" = "main" ] && ! git -C "$META_DIR" ls-remote --exit-code origin refs/heads/v2 >/dev/null 2>&1; then
  run "meta: rename main → v2"  gh api -X POST "repos/$META_REPO/branches/main/rename" -f new_name=v2
  run "meta: rename v3 → main"  gh api -X POST "repos/$META_REPO/branches/v3/rename"  -f new_name=main
  run "meta: default = main"    gh repo edit "$META_REPO" --default-branch main
else
  note "meta swap appears done or state differs (default=$meta_default) — verify manually"
fi
# local remaps
if [ "$(git -C "$META_V3_WT" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "v3" ]; then
  run "meta worktree: v3→main" git -C "$META_V3_WT" branch -m v3 main
  run "meta worktree fetch" git -C "$META_V3_WT" fetch origin --prune
  run "meta worktree track" git -C "$META_V3_WT" branch -u origin/main main || true
fi
if [ "$(git -C "$META_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ]; then
  run "meta old checkout: main→v2" git -C "$META_DIR" branch -m main v2
  run "meta old checkout fetch" git -C "$META_DIR" fetch origin --prune
  run "meta old checkout track" git -C "$META_DIR" branch -u origin/v2 v2 || true
fi

# ── P8 smoke ──────────────────────────────────────────────────────────────────
say "P8 smoke"
if [ "$DRY" -eq 1 ]; then
  note "DRY: gh release view $TAG / npm view version / node dist/roll.mjs status"
else
  gh release view "$TAG" -R "$REPO" --json tagName,name --jq '"GitHub Release: \(.tagName)"' || note "release not visible yet (workflow may still be running)"
  note "npm view (registry 可能有分钟级延迟): $(npm view @seanyao/roll version 2>/dev/null || echo pending)"
  node "$V3_WT/dist/roll.mjs" version
fi

say "🎉 done — Roll v3.0.0 发布完成"
note "回滚（如需）：反向 rename + gh release delete $TAG + npm deprecate @seanyao/roll@3.0.0"
