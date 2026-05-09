---
name: roll-release
license: MIT
allowed-tools: "Read, Edit, Bash(git:*), Bash(npm:*), Bash(sed:*), Bash(date:*), Bash(gh:*)"
description: "Release skill for roll maintainers. Calculates next version (YYYY.MMDD.N format, auto-increments N from today's git tags), updates VERSION in bin/roll and package.json, commits, tags, and pushes to trigger npm auto-publish via GitHub Actions. Trigger: release, publish, 发版, 发布新版本."
---

# Release (roll-release)

One-command publish flow for roll maintainers.

## When Not to Use

- Non-maintainer users (this skill publishes the package defined in `package.json` — confirm scope before running)
- Internal project releases — only for the `roll` CLI package itself
- Hotfixing code without a version bump (use `$roll-fix`)
- Generating user-facing release notes (use `$roll-.changelog`)

## Version Format

`YYYY.MMDD.N` — e.g. `2026.419.1`

- `YYYY.MMDD` = today's date, month has **no leading zero** (e.g. `420` not `0420`)
- `N` = auto-incremented from existing git tags for today (starts at 1)

## Execution Steps

### Step 1: Calculate Version

First, inspect recent tags to confirm the actual format in use:

```bash
git tag | sort -V | tail -5
```

Then calculate:

```bash
today=$(date +%Y.%-m%d)
last_n=$(git tag | grep "^v${today}\." | sed "s/^v${today}\.//" | sort -n | tail -1)

# Reuse tag if latest today's tag already points to HEAD (e.g. npm publish failed, retrying)
if [[ -n "$last_n" ]]; then
  last_tag="v${today}.${last_n}"
  if [[ "$(git rev-list -n1 "$last_tag")" == "$(git rev-parse HEAD)" ]]; then
    version="${today}.${last_n}"
    echo "♻️  Reusing ${last_tag} — same commit, skipping version bump"
    # Skip Steps 2-4, jump directly to Step 5 (GitHub Release) or Step 6 (npm publish)
  else
    n=$(( last_n + 1 ))
    version="${today}.${n}"
  fi
else
  version="${today}.1"
fi
```

Show the proposed version to the user:
```
Recent tags: v2026.419.1  v2026.419.2  v2026.420.3
Proposed version: 2026.420.4        ← new version (code changed since last tag)
  — or —
♻️  Reusing v2026.420.3             ← same commit, retry after npm failure
Proceed? [y/N]
```

Wait for confirmation before continuing.

### Step 2: Update Version Fields

**`bin/roll`** — update the VERSION line:
```bash
sed -i '' "s/^VERSION=.*/VERSION=\"${version}\"/" bin/roll
```

**`package.json`** — update the version field:
```bash
npm version "${version}" --no-git-tag-version
```

Verify both files show the new version before continuing.

### Step 3: Commit

```bash
git add bin/roll package.json
git commit -m "[release] v${version}"
```

### Step 4: Tag and Push

```bash
git tag "v${version}"
git push && git push --tags
```

### Step 5: Create GitHub Release

**This step is mandatory.** Without it, `roll` update notifications will not work.

Convert version to changelog date, extract notes, then create the release:

```bash
# Convert version (2026.510.3) to changelog date (2026.05.10)
_year=$(echo "${version}" | cut -d. -f1)
_mmdd=$(echo "${version}" | cut -d. -f2)
if [ ${#_mmdd} -eq 3 ]; then
  _cl_date="${_year}.0${_mmdd:0:1}.${_mmdd:1:2}"
else
  _cl_date="${_year}.${_mmdd:0:2}.${_mmdd:2:2}"
fi

# Extract release notes from CHANGELOG.md
notes=$(sed -n "/^## ${_cl_date}$/,/^## /{ /^## ${_cl_date}$/d; /^## /d; p; }" CHANGELOG.md | sed '/^[[:space:]]*$/d')

gh release create "v${version}" \
  --title "v${version}" \
  --notes "${notes:-Release v${version}}"
```

This enables the background update check in `bin/roll` (`_check_update_async`), which queries the GitHub Releases API.

### Step 6: Publish to npm

```bash
npm publish --access public
```

This will open a browser for 2FA verification. Wait for it to complete before continuing.

### Step 7: Confirm

After publish, show:
```
✅ Released v{version}
🏷  Tag: v{version} pushed to origin
📦 npm published: {package_name}@{version}   # package name read from package.json
🐙 GitHub Release: https://github.com/{owner}/{repo}/releases/tag/v{version}
🔗 https://www.npmjs.com/package/{package_name}
```

## Abort Conditions

- Uncommitted changes in `bin/roll` or `package.json` → warn and abort
- Tag already exists for today's N → increment N and re-propose
- `git push` fails → show error, do not leave a dangling local tag (run `git tag -d v{version}`)
