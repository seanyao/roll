# Refactor Plan — Engineering Discipline

> **Background**: See full analysis at `~/.claude/plans/cosmic-discovering-hellman.md`  
> **Author**: Kent Beck review session, 2026-04-16

## Why This Refactor

Wukong v0.2.0 enforces engineering discipline on other projects but violates it itself:

- **Zero automated tests** — AGENTS.md requires >80% coverage; bin/wukong has 0%
- **165-line cmd_init()** — six execution paths tangled in one function
- **AI tool list hardcoded in two places** — diverges when new tools appear  
- **merge_convention() silently skips updated sections** — users never see template changes
- **Scaffold creates docs/plans/ but AGENTS.md says docs/features/** — contradicts itself

## Execution Order (Dependency-Driven)

```
US-REF-001 (bats framework + unit tests)
    └→ US-REF-002 (integration tests)
         ├→ US-REF-003 (cmd_init refactor)
         ├→ US-REF-004 (AI tool config unification)
         └→ US-REF-005 (merge_convention fix)

US-REF-001
    └→ US-REF-006 (docs/plans scaffold fix) ← independent, fastest win
```

US-REF-001 is the prerequisite for everything. Without tests, refactoring is walking blind.

## Test Strategy

**Tool**: [bats-core](https://github.com/bats-core/bats-core)  
**Target coverage**: helper functions >80%, commands integration 100%

```
tests/
├── unit/
│   ├── config_get.bats           # edge cases: missing key, ~ expansion, colons in value
│   ├── scan_project_type.bats    # 8 combinations: frontend×backend×cli flags
│   ├── detect_project_type.bats  # AGENTS.md marker detection + fallback
│   ├── ai_tool_name.bats         # ~/.openclaw/workspace → "openclaw"
│   └── merge_convention.bats     # 3 modes: fresh/overwrite/merge
├── integration/
│   ├── cmd_setup.bats            # creates ~/.wukong structure correctly
│   ├── cmd_sync.bats             # distributes files, appends @wk.md
│   ├── cmd_init.bats             # fresh/legacy/refresh paths; no docs/plans/ created
│   └── cmd_status.bats           # output format, sync states
└── fixtures/
    ├── projects/                 # pre-built project dirs for tests
    └── configs/                  # test config.yaml variants
```

## AI Tool Config Design (Sprint 3)

Current: two hardcoded arrays, different contents.

Target: config.yaml becomes single source of truth:

```yaml
ai_tools:
  claude:
    dir: ~/.claude
    config: CLAUDE.md
    convention_src: CLAUDE.md
  gemini:
    dir: ~/.gemini
    config: GEMINI.md
    convention_src: GEMINI.md
  kimi:
    dir: ~/.kimi
    config: AGENTS.md
    convention_src: AGENTS.md
  codex:
    dir: ~/.codex
    config: AGENTS.md
    convention_src: AGENTS.md
  cursor:
    dir: ~/.cursor
    config: .cursor-rules
    convention_src: .cursor-rules
  openclaw:
    dir: ~/.openclaw/workspace
    config: AGENTS.md
    convention_src: AGENTS.md
```

Both `_link_skills` and `_sync_conventions` read from this config.  
Adding a new AI tool = editing config.yaml only, no code change.

## merge_convention() Fix Design (Sprint 4)

Current behavior for Merge mode:
```
for each ## section in template:
  if heading not in target → append  ✓
  if heading in target     → skip silently  ← BUG: misses content updates
```

New behavior:
```
for each ## section in template:
  if heading not in target    → append  (unchanged)
  if heading in target, same  → skip    (unchanged)
  if heading in target, DIFF  → show diff + ask:
      [u] update with template
      [k] keep mine
```

This makes convention updates visible — users can see what changed and decide.
