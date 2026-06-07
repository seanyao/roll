# Roll — Changelog

Roll keeps `CHANGELOG.md` in sync automatically. You never have to write or
update it manually.

## How It Works

1. `$roll-build` (or `$roll-fix`) delivers a story and stages `CHANGELOG.md`.
2. The story completion commit includes `CHANGELOG.md` — no separate commit.
3. On release, Roll's release process renames `## Unreleased` to the version tag.

## What Gets Written

The `$roll-.changelog` skill reads `BACKLOG.md` and writes a bullet for each
completed story or fix. It filters for user-visible changes only:

**Written:**
- New commands users can invoke
- Bug fixes users would notice
- Visible behavior changes (layout, output, speed)
- Install / upgrade changes

**Skipped:**
- Internal refactors
- Test infrastructure changes
- Developer-only bug fixes
- Implementation details

The skill enforces a style gate — bullets are short, plain-language,
user-facing. Technical jargon triggers a rewrite loop.

## Release-ready sections

`roll release` treats the changelog as ready in either shape: an
`## Unreleased` section with bullets, **or** a pre-written next-version
section at the top (`## v3.608.1 — 2026-06-08`) naming a version newer than
package.json's current — the release flow's own convention. A first section
matching the current version means everything is already shipped.

```markdown
## Unreleased
- **Added**: `roll loop runs` — instantly see what loop ran and when
- **Fixed**: `roll update` no longer reports the wrong version after upgrading

## v2026.05.07
- ...
```

## First-Time Backfill

If your project has no `CHANGELOG.md` yet, `$roll-.changelog` creates one
and backfills all historical completed stories, grouped by date.

## Manual Trigger

```bash
$roll-.changelog   # stage CHANGELOG.md (call from within a build session)
```

When called outside a build session (standalone), it stages and commits
with `chore: sync changelog`.

## See Also

- [loop.md](loop.md) — loop triggers changelog automatically after each story
- [skills.md](skills.md) — `roll-.changelog` in the support skills table
