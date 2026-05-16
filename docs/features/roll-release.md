# Feature: Release Script

> **2026-05-16 update**: The `roll-release` skill and `roll release` CLI subcommand
> have been removed. Release flow is now 100% script-driven via `scripts/release.sh`
> — npm publish requires real-terminal 2FA, which a skill cannot orchestrate.
> US-REL-001 below is kept as historical record.

<a id="us-rel-001"></a>
## US-REL-001 Add roll-release skill — one-command publish flow ✅ (superseded)

**Created**: 2026-04-19
**Completed**: 2026-04-20

- As a roll maintainer
- I want to run `$roll-release` to publish a new version
- So that releasing is a single command with no manual version calculation

**AC:**
- [x] Skill file `skills/roll-release/SKILL.md` created
- [x] Version format: `YYYY.MMDD.N` (e.g. `2026.419.1`); N auto-increments from existing git tags for today
- [x] Updates `VERSION="..."` in `bin/roll`
- [x] Updates `"version"` field in `package.json`
- [x] Commits with message `[release] vYYYY.MMDD.N`
- [x] Creates git tag `vYYYY.MMDD.N` and pushes with `git push && git push --tags`
- [ ] GitHub Actions `publish.yml` auto-publishes to npm on tag push (OIDC Trusted Publishing pending — workaround: `npm publish` locally)
- [x] Skill shows proposed version and asks for confirmation before making any changes
- [x] Added to README skill list

**Files:**
- `skills/roll-release/SKILL.md` (new)
- `README.md`

**Dependencies:**
- `.github/workflows/publish.yml` must exist (already done in US-DIST-004)
