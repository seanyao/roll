# Migrating to Roll 2.0

> **TL;DR:** Run `npx @seanyao/roll@2 migrate --dry-run`, review, then `npx @seanyao/roll@2 migrate`. One atomic commit. Done.

Roll 2.0 moves all "process" artifacts (BACKLOG, PROPOSALS, feature specs, briefs, dream logs, design docs) from your project root + `docs/` into a single `.roll/` directory. User-facing docs (`docs/guide/`, `docs/site/`) move up to the project root.

This is a one-time, breaking change. Your existing files keep their git history — Roll uses `git mv`.

## Before you start

- **Pin your old version** if you want a safety net: `npm install -g @seanyao/roll@1`. Old npm versions never go away, so you can always go back.
- **Make sure your working tree is clean.** `npx @seanyao/roll@2 migrate` refuses to run with uncommitted changes. Commit or stash first.
- **Optional but recommended**: read this whole page before running.

## What will move

| Old path | New path | Notes |
|----------|----------|-------|
| `BACKLOG.md` (root) | `.roll/backlog.md` | The main project workflow file |
| `PROPOSALS.md` (root) | `.roll/proposals.md` | Pending proposals |
| `docs/features.md` | `.roll/features.md` | Feature index |
| `docs/features/` | `.roll/features/` | Per-feature specs |
| `docs/dream/` | `.roll/dream/` | `roll-.dream` output (auto-generated) |
| `docs/design/` | `.roll/design/` | Design exploration docs |
| `docs/domain/` | `.roll/domain/` | DDD models |
| `docs/practices/loop-autorun-verification.md` | `.roll/features/loop-engine/loop-autorun-verification.md` | Execution records |
| `docs/practices/engineering-common-sense.md` | `guide/en/practices/engineering-common-sense.md` | Engineering norm (user-facing) |
| `docs/intro/` | `site/slides/` | Promotional HTML pages |
| `docs/guide/en/` | `guide/en/` | User docs (English) |
| `docs/guide/zh/` | `guide/zh/` | User docs (Chinese) |
| `docs/site/` | `site/` | Marketing site source |

After migration, your `docs/` directory is gone. If you had your own files in `docs/` outside this list, `npx @seanyao/roll@2 migrate` won't touch them.

## Why two destinations

Roll 2.0 enforces an architectural split:

- **`.roll/`** = process artifacts, for *us* (the maintainers). Backlog, dream logs, design notes.
- **Root** = product artifacts, for *others*. README, guide, site, source code.

Whether `.roll/` is gitignored is your choice (see [Privacy](#privacy) below). Whether it's tracked is orthogonal to the directional split.

## Three-state safety

`npx @seanyao/roll@2 migrate` is idempotent and refuses to do anything dangerous:

| State | Action |
|-------|--------|
| Old paths only | Migrate (single atomic commit) |
| `.roll/` only, no old paths | No-op with "already migrated" message |
| Both present | **Refuse** — list conflicts, require manual resolution |
| Neither present | No-op |

If you stop midway, the partial state goes into the "both" bucket and you'll get a clear conflict report on the next run.

## Step by step

### 1. Update Roll to 2.0

```bash
npm install -g @seanyao/roll@2
npx @seanyao/roll@2 version    # Should show 2.x
```

### 2. Preview the migration

```bash
cd your-project
npx @seanyao/roll@2 migrate --dry-run
```

This prints a table of every move. Nothing happens to your files.

### 3. Execute

```bash
npx @seanyao/roll@2 migrate
```

You'll see a single commit on your current branch:

```
Migrate project layout to .roll/ structure

Paths migrated: 14
```

`git log --follow .roll/backlog.md` should still show the full history from `BACKLOG.md`.

### 4. Verify

```bash
roll status          # Should run cleanly
ls -la .roll/        # New structure
git log -1           # The migration commit
```

If anything looks wrong, revert with `git revert HEAD`.

## Privacy

By default, `.roll/` is **tracked** (visible to everyone with repo access). If you want process artifacts private:

```bash
echo ".roll/" >> .gitignore
git add .gitignore && git commit -m "chore: gitignore .roll/"
```

Then untrack what's already been committed:

```bash
git rm -r --cached .roll/
git commit -m "chore: stop tracking .roll/"
```

Roll itself uses a separate **private repo** (`seanyao/roll-meta`) instead of gitignoring — that's a valid pattern too, but only makes sense if you want totally separate access controls.

## Rolling back

If you need to undo:

```bash
git revert HEAD                          # Undo the migration commit
npm install -g @seanyao/roll@1           # Reinstall old Roll
```

Your file history is preserved either way (`git mv` doesn't lose blame).

## Updates to other tools

After migration:

- `roll status`, `roll backlog`, `roll loop` — all automatically use the new paths
- `$roll-build`, `$roll-fix`, `$roll-design` skills — all updated; just re-run `roll setup` to refresh
- Any external scripts referencing `BACKLOG.md` etc. — **you need to update those manually**

## FAQ

**Q: Can I migrate one piece at a time?**
No. Migration is atomic — single commit. The "both" state intentionally errors out so you never end up in a half-migrated mess.

**Q: What about CI / GitHub Actions referencing old paths?**
Update them in the same commit window. If CI breaks after migration, that's almost always a stale path reference in a workflow file.

**Q: My team uses Roll on multiple projects. Do I need to migrate all of them?**
Each project independently. Roll 2.0 refuses to run on old structure with a clear hint pointing to `npx @seanyao/roll@2 migrate`, so nothing silently breaks.

**Q: Can I skip migration and stay on Roll 1.x forever?**
Yes. Old npm versions are permanent. But you'll miss new features (legacy onboarding, agent discovery, plan-driven init).

**Q: Roll runs `npm test` and many tests fail after migration — is that expected?**
No. The migration should not change test outcomes. If tests break, run `git diff HEAD~1` to see what moved and look for paths in test files or fixtures that didn't get migrated. File an issue with the diff.
