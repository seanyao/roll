---
hidden: true
name: roll-.dream
license: MIT
allowed-tools: "Read, Glob, Grep, Bash(git:*), Write, Edit"
description: |
  Nightly code and architecture health scan. Passively triggered by scheduler
  (cron or GitHub Actions), not invoked by users directly. Detects dead code,
  architectural drift from domain model, pruning candidates, and emerging patterns.
  Outputs REFACTOR entries to BACKLOG.md and a daily log to docs/dream/.
  Distinct from roll-sentinel: sentinel monitors runtime behavior; dream reviews
  code structure and architectural health.
---

# Roll Dream (Nightly Code Health Scan)

> Follows the Architecture Constraints, Development Discipline, and Engineering
> Common Sense defined in the project AGENTS.md.

**Passively triggered — do not invoke manually.** Runs nightly via scheduler.
Consolidates structural signals accumulated during the day, surfaces technical
debt, and writes REFACTOR entries to BACKLOG. The human reviews the dream log
in the morning brief.

## Distinction from roll-sentinel

| | roll-sentinel | roll-.dream |
|--|--------------|------------|
| **Trigger** | Post-deploy, scheduled patrol | Nightly, fixed schedule |
| **Target** | Runtime behavior (production) | Code structure (codebase) |
| **Output** | FIX entries | REFACTOR entries + dream log |
| **Question** | "Is the product working?" | "Is the code healthy?" |

## Scan Logic

Run all four scans every night. Each scan is independent.

### Scan 1 — Dead Code

Find code that is defined but never referenced:

```bash
# Unused exports (TypeScript/JS)
grep -r "^export " src/ --include="*.ts" -l | while read f; do
  symbol=$(grep -o "export \(function\|const\|class\|type\|interface\) [A-Za-z]*" "$f" | awk '{print $NF}')
  # check if symbol appears anywhere else in the codebase
done

# Unused files (no imports pointing to them)
# Git: files not touched in 90+ days and not imported anywhere
git log --since="90 days ago" --name-only --format="" | sort -u > /tmp/recently_touched
```

Flag: files or exports with zero references outside their own file.

### Scan 2 — Architectural Drift

Compare current code structure against the domain model in `docs/domain/`:

```bash
# Read context-map.md and ubiquitous-language.md if they exist
# Check: do module/directory names match Bounded Context names?
# Check: do cross-module imports respect Context boundaries?
# Check: do any modules import directly across Context lines without ACL?
```

Flag: modules that import directly from a different Bounded Context without
an Anti-Corruption Layer, or module names that have diverged from the
Ubiquitous Language.

### Scan 3 — Pruning Candidates

Find over-engineering that can be simplified:

```bash
# Abstractions with only one implementation
grep -r "interface \|abstract class " src/ --include="*.ts" -l

# Wrapper functions that do nothing but delegate
# Config flags that are never toggled (always true or always false)
# Error handling for paths that cannot occur
```

Flag: interfaces with exactly one implementor, feature flags frozen to one
value, wrapper layers with no logic.

### Scan 4 — Emerging Patterns

Find repeated structures that warrant extraction:

```bash
# Duplicated code blocks (>10 lines, similar structure)
# Similar file structures across multiple modules
# Repeated try/catch patterns with identical handling
```

Flag: any pattern appearing 3+ times that could be extracted into a shared
utility or convention.

## Output

### REFACTOR Entry (BACKLOG.md)

For each finding that warrants action, append one row to the `## ♻️ Refactor`
section of BACKLOG.md:

```markdown
| REFACTOR-XXX | {one-line description} — flagged by dream {YYYY-MM-DD} | 📋 Todo |
```

**Threshold**: only flag items where the fix would meaningfully reduce
complexity or prevent future bugs. Ignore cosmetic issues.

### Dream Log (docs/dream/YYYY-MM-DD.md)

Always write a log, even when no REFACTOR entries are created:

```markdown
# Dream Log {YYYY-MM-DD}

## Summary
- Scans run: Dead Code / Architectural Drift / Pruning / Patterns
- Findings: {N} flagged, {M} REFACTOR entries created

## Dead Code
{finding or "Nothing flagged."}

## Architectural Drift
{finding or "No drift detected."}

## Pruning Candidates
{finding or "Nothing flagged."}

## Emerging Patterns
{finding or "No patterns detected."}

## REFACTOR Entries Created
{list or "None."}
```

## Scheduler Configuration

roll-.dream runs **locally** — it reads the local codebase directly.

### Local cron (default)

Installed automatically via `roll loop on` alongside roll-loop and roll-brief.
The cron entry is generated using the configured agent — no manual cron editing needed.

## Failure Handling

If the scan fails partway through:

1. Write partial results to `docs/dream/YYYY-MM-DD.md` with a `## Status: PARTIAL` header
2. Do not write incomplete REFACTOR entries to BACKLOG
3. Log the error to `~/.shared/roll/dream/error.log`

The scheduler (not this skill) is responsible for retry and human notification.
