---
hidden: true
name: roll-.review
license: MIT
allowed-tools: "Read, Bash(git:*)"
description: Self code review step in the TCR workflow. Runs after each micro-step is completed and before commit, checking code quality, security, and design issues.
---

# WK Self Code Review

**Quality gate for the TCR loop** - Self-review after each micro-step is completed and before commit.

## Position in WK Workflow

```
TCR Loop:
  Write Test → Run Test → ✅ Green → Self Review → Commit
                                          ↓
                                     Critical?
                                   Yes → Fix → Redo
                                    No → Proceed
```

## When Triggered

- **Auto-triggered**: After each TCR micro-step in `$roll-build` / `$roll-fix`
- **Manual trigger**: When the user wants to review current changes

## When Not to Use

- Docs-only changes (README, CHANGELOG) with no code diff
- Test pyramid / coverage standards check (use `$roll-.qa`)
- Post-deploy production sampling (use `$roll-sentinel`)

## Review Scope

```bash
# Default: review staged changes (recommended for TCR)
$roll-.review staged

# Review all uncommitted changes
$roll-.review unstaged

# Review specific files
$roll-.review files src/utils.ts
```

## Review Dimensions (7 Core Dimensions)

Original 6 dimensions plus Reuse (added in REFACTOR-022, simplify three-axis integration):

```
┌─────────────────────────────────────────────────────────┐
│  WK Quality Checklist                                   │
├─────────────────────────────────────────────────────────┤
│  ✅ Correctness     - Logic is correct, no bugs         │
│  ✅ Security        - No vulnerabilities, input valid.  │
│  ✅ Maintainability - Clear naming, sound structure     │
│     Quality anti-patterns (check each):                 │
│       □ Redundant state / cached values that could be   │
│         derived directly                                │
│       □ Parameter sprawl — new param vs. restructure    │
│       □ Copy-paste with slight variation (near-dup)     │
│       □ Leaky abstraction — exposes internal details    │
│       □ Stringly-typed — raw string where constant      │
│         / enum exists                                   │
│       □ Unnecessary JSX nesting (no layout value)       │
│       □ Nested conditionals ≥3 deep (ternary chains,    │
│         nested if/else) — flatten with early return     │
│       □ Unnecessary comments explaining WHAT            │
│  ✅ Performance     - No performance pitfalls           │
│     Efficiency anti-patterns (check each):              │
│       □ Redundant computation / repeated file read /    │
│         duplicate API call / N+1 pattern                │
│       □ Missed concurrency — independent ops sequential │
│       □ Hot-path bloat — blocking work in startup or    │
│         per-request path                                │
│       □ Loop no-op updates — missing change-detection   │
│         guard                                           │
│       □ TOCTOU existence pre-check — operate directly + │
│         handle error instead                            │
│       □ Memory — unbounded structures / missing cleanup │
│       □ Overly broad op — reading full file for a slice │
│  ✅ Testability     - Easy to test, edge cases covered  │
│  ✅ Scope           - Focused on current task, no       │
│                       unrelated changes                 │
│  ✅ Reuse           - No new code duplicating existing  │
│     □ New function duplicates existing utility/helper   │
│     □ Inline logic replaceable by existing tool         │
└─────────────────────────────────────────────────────────┘
```

**Usage in TCR**: Each micro-step review is a lightweight self-check against this checklist — no sub-agents, zero extra token cost. The three-axis deep review with parallel agents runs once per Story in `$roll-build` Phase 7.

## Severity Levels and Decisions

| Level | Definition | Decision |
|-------|-----------|----------|
| 🔴 **Critical** | Bug, security vulnerability | **Must fix**, redo TCR |
| 🟡 **Warning** | Maintainability issue | **Recommend fix** or document |
| 🟢 **Suggestion** | Minor optimization | Optional, proceed with commit |
| ✅ **Pass** | No issues | Proceed with commit |

## Output Format

```markdown
## Self Review Report
**Scope**: staged (2 files, +45/-12 lines)

### 🔴 Critical (Must Fix)
| File | Line | Issue | Action |
|------|------|-------|--------|
| auth.ts | 23 | SQL injection | Use parameterized query |

### 🟡 Warnings
- utils.ts:45 - Magic number, consider: `const MAX_RETRY = 3`

### ✅ Passed
- Naming conventions
- Error handling
```

## TCR Integration

In each micro-step of `$roll-build`:

```markdown
**Micro-Step X: [Description]**

1. Write/Update Test
2. Run Test → ✅ Green
3. **$roll-.review staged**
   - 🔴 Critical? → Fix → Redo step
   - 🟡 Warning? → Quick fix or document
   - ✅ Pass? → Proceed
4. git commit -m "tcr: description"
```

## WK Principle Alignment

- **Agent-First**: Structured review checklist, executable by AI
- **Check Phase**: Local quality control
- **Micro-steps**: Small fast steps, each review < 100 lines
- **TCR**: Can only commit after passing self-check, ensuring repo quality
