# roll-doc-audit — Documentation/Product Consistency Audit

`roll-doc-audit` checks user-facing documentation surfaces against implemented
behavior: README, guides, site pages, CLI help, tests, and source. When a
documentation inventory is requested, it also produces draft documentation: a
doc index, module READMEs for undocumented directories, and — in Phase 3b —
deep cross-directory topic docs (data flows, state machines, integrations, and
more). It never invents behavior without source evidence.

```
$roll-doc-audit              # full run (all phases)
$roll-doc-audit --dry-run    # Phases 1–2 only; print the Phase 3 / 3b plan, write nothing
$roll-doc-audit --force      # regenerate drafts even when target files already exist
```

## The Four-Phase Pipeline

roll-doc-audit runs four phases in order, plus a deep-read Phase 3b that fires when
the project has cross-directory structure worth documenting.

| Phase | Name | What it does |
|-------|------|--------------|
| 1 | Scan & Index | Walk the tree, classify every `*.md` and convention file, (over)write `docs/INDEX.md` with a coverage summary and gap report. |
| 2 | Gap Analysis | Find module directories with ≥ 3 source files (or imported by ≥ 5 files) and no `README.md`, plus special gaps (domain map, conventions doc). |
| 3 | Fill | For each directory-level gap, read up to 20 files from that directory and generate a draft `README.md` / context map / conventions doc. Skip existing files unless `--force`. |
| 3b | Deep Read | Build a full project symbol table (no truncation) and detect six cross-directory topics that Phase 3 alone cannot find. |
| 4 | Report | Print a per-phase summary: docs indexed, gaps found, drafts generated, Phase 3b symbol-table counts and topic docs. |

Phase 3b is the difference between "directory-by-directory" docs and docs that
follow logic across the whole codebase. Phase 3 reads each gap directory in
isolation (and only a capped number of files per directory); Phase 3b reads
every source file in full and reasons across files.

## Phase 3b — The Six Topics

Phase 3b runs when **either** Phase 2 found a gap **or** the project shows
code characteristics Phase 3 cannot capture (import chains spanning ≥ 3
directories, shared state enums, external endpoint calls, or CI config). A
pure docs-only project with no source gaps skips Phase 3b entirely.

After building the symbol table (`exports`, `imports`, `enums`,
`external_urls`, `configs`), Phase 3b detects six topic types. Each is skipped
when its detection rule finds nothing, and skipped when its target file already
exists (unless `--force`).

| # | Topic | Trigger condition | Output |
|---|-------|-------------------|--------|
| 1 | Data flow / call chain | An import chain from an entry file (`bin/`, `main.*`, `index.*`) spans ≥ 3 distinct source directories | `docs/data-flows.md` |
| 2 | State machine | An enum named `*State` / `*Status` referenced by ≥ 2 source files | `docs/state-machines.md` |
| 3 | External integrations | `fetch` / `axios` / `http.*` calls or `*_URL` / `*_HOST` constants (outside comments and test fixtures) | `docs/integrations.md` |
| 4 | Deployment pipeline | A CI config file (`.github/workflows/*.yml`, `.gitlab-ci.yml`, `circle.yml`, `Jenkinsfile`) plus a deploy URL pattern | `docs/deployment.md` |
| 5 | Agent entrypoint | No `AGENTS.md` at root AND the source root has ≥ 3 subdirectories | `AGENTS.md` |
| 6 | High fan-in directory | A directory imported by ≥ 5 other source files, even with < 3 source files | `<dir>/README.md` |

Every topic doc cites `file:line` for each claim, sourced from real symbol-table
records — roll-doc-audit never fabricates a line number.

## dry-run / force Behavior

**`--dry-run`** runs Phases 1–2, then prints the Phase 3 fill plan and the
Phase 3b plan (symbol-table summary counts plus the topic docs it *would*
generate, each tagged `(plan)`). Nothing is written to disk. Use it to preview
before committing to a full run.

**`--force`** regenerates drafts even when the target file already exists. It
affects only draft generation (Phase 3 and Phase 3b output files); the symbol
table is rebuilt from scratch on every run regardless of flags. `--force` never
touches `docs/INDEX.md` behavior (always rebuilt) and never overwrites human
content outside the draft targets.

**Default (no flag)** is idempotent: re-running when no new gaps exist is a
no-op — no files written, no existing drafts modified.

## Typical Output Files

A full run on a code-bearing project may produce:

```
docs/INDEX.md            # Phase 1 — always (over)written
src/<module>/README.md   # Phase 3 — one per module gap
docs/CONVENTIONS.md      # Phase 3 — when no conventions doc exists
.roll/domain/context-map.md  # Phase 3 — when no domain entries exist
docs/data-flows.md       # Phase 3b — cross-directory call chains
docs/state-machines.md   # Phase 3b — shared state enums
docs/integrations.md     # Phase 3b — external endpoints
docs/deployment.md       # Phase 3b — CI pipeline
AGENTS.md                # Phase 3b — only when none exists
<dir>/README.md          # Phase 3b — high fan-in directories
```

Only `docs/INDEX.md` is ever overwritten — it is a derived artifact. Every
other file is a draft headed with:

```
> **Draft** — auto-generated by roll-doc-audit on YYYY-MM-DD. Review before treating as authoritative.
```

Review each draft, edit as needed, and commit the ones you want to keep.
