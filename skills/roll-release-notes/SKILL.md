---
name: roll-release-notes
license: MIT
allowed-tools: "Read, Edit, Write, Bash(git:*), Bash(gh:*), Bash(roll:*)"
description: |
  Generate the GitHub Release notes ahead of a release, decoupled from the
  release script's critical path. Reads the CHANGELOG `## Unreleased` section
  (plus merged PRs since the last tag for context) and writes a polished,
  bilingual RELEASE_NOTES.md the owner can review/edit before cutting the
  release. `roll release` then publishes that file as-is — no inline AI wait.
  Trigger: "生成 release notes", "release notes", "写发布说明", or `roll release-notes`.
---

# Roll Release Notes

Produce the release notes **before** release time so the owner can review them
and the release script doesn't have to stop and generate them inline (US-REL-004).

> Distinct from `roll-.changelog`: changelog turns the internal BACKLOG into
> `CHANGELOG.md` (the running log). Release notes are the **outward-facing
> GitHub Release body** for one version — they build *on* the CHANGELOG's
> `## Unreleased` section, polished for an external reader.

## Steps

1. **Seed the file deterministically.** Run `roll release-notes [version]` —
   it extracts the CHANGELOG `## Unreleased` body into `RELEASE_NOTES.md`
   under a version header. (If the section is empty, stop: nothing to release.)

2. **Gather extra context (optional).** For richer notes, list the PRs merged
   since the last tag:
   - `git describe --tags --abbrev=0` → last tag
   - `gh pr list --state merged --base main --search "merged:>=<tag-date>"`
   Use these only to clarify wording — never invent changes not in the CHANGELOG.

3. **Polish RELEASE_NOTES.md** (edit in place):
   - Lead with a one-line summary of the release's theme.
   - Group under **Added / Fixed / Improved / Docs** (drop empty groups).
   - User-facing voice: what changed *for the user*, not internal mechanics.
     Strip internal `[tag]` markers and story IDs from the prose.
   - **Bilingual per project convention**: English and 中文 on **separate
     lines**, never inline on the same line.
   - Keep it honest: only what actually shipped in this version.

4. **Leave it for review.** Do NOT cut the release. The owner reviews/edits
   `RELEASE_NOTES.md`; `roll release` consumes it verbatim when present.

## Hard rules

- Never fabricate entries. Every line traces to a CHANGELOG `## Unreleased`
  bullet or a merged PR.
- Never bump versions, tag, or publish — that is the human-run release step.
- Output is exactly one file: `RELEASE_NOTES.md` at the repo root.
