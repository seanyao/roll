# Feature: Directory Restructure (.roll/ Convention)

> Part of Epic: Legacy Project Onboarding + 项目管理剥离
> Design doc: [docs/design/legacy-onboard-epic.md](../design/legacy-onboard-epic.md)
> ADRs: PROPOSALS.md (ADR-001 through ADR-004)

## US-ONBOARD-001: `.roll/` 目录约定

Define the `.roll/` directory convention as the standard for all Roll-managed projects.

**Acceptance Criteria:**
- [ ] Convention document published (in this feature doc or a standalone spec)
- [ ] Complete file-to-directory mapping table: which files are "process" (→ `.roll/`) vs "product" (→ root)
- [ ] `guide/` uses language as top-level dimension (`en/`, `zh/`)
- [ ] `docs/practices/` split rule documented: norms → `guide/{lang}/practices/`, execution records → `.roll/verification/`
- [ ] `docs/intro/` → `site/slides/` documented
- [ ] Self-containment constraint: `.roll/` files must not use outward relative paths
- [ ] Two-phase model noted: Phase 1 = in-repo `.roll/`, Phase 2 = lift to `roll-meta`

**Deliverable:** This document + ADR-001 in PROPOSALS.md (already drafted).

---

## US-ONBOARD-002: 路径引用全量审查

Audit every reference to old directory paths across the entire codebase.

**Acceptance Criteria:**
- [ ] `path-audit.md` produced with every reference point: file + line number + context
- [ ] Each reference tagged as "read" or "write"
- [ ] Literal string references and variable-based references in separate tables
- [ ] Variable-based paths manually reviewed: `cmd_brief`, `cmd_loop`, `_write_backlog`, `briefs_dir`, `features_dir` and similar dynamic path construction
- [ ] Each reference tagged as "needs file migration" (roll migrate scope) vs "code-only replacement"
- [ ] Coverage: `bin/roll`, `skills/*/SKILL.md`, `tests/`, `conventions/`, `lib/`, `hooks/`, `scripts/`, `template/`, `templates/`
- [ ] `path-audit.md` is the single source of truth for all subsequent path changes

**Hard gate:** No code changes in Story 3+ may merge without tracing back to this audit.

---

## US-ONBOARD-003: `roll migrate` 命令

One-shot migration command that moves old directory structure to new.

**Acceptance Criteria:**
- [ ] `roll migrate --dry-run` previews all changes without modifying files
- [ ] `roll migrate` executes: `git mv` preserving history → single atomic commit
- [ ] Three target directories: `guide/`, `site/` (including `slides/`), `.roll/`
- [ ] Three-state idempotency:
  - Old paths only → execute migration
  - `.roll/` only → no-op with "already migrated" message
  - Both exist (partial migration) → error with list of residual paths, require manual confirmation
- [ ] All path changes traceable to `path-audit.md` from Story 2
- [ ] `.gitignore` updated if project already has one (add `.roll/` entry if user chooses)
- [ ] Commit message follows project convention: `Story 3: ...`

---

## US-ONBOARD-004: 结构强制检测 + 全局命令豁免

New Roll version refuses to run project commands on old directory structure.

**Acceptance Criteria:**
- [ ] On startup (before any project command), check directory structure
- [ ] Old structure detected → refuse execution, print `roll migrate` guidance
- [ ] `.roll/` detected → normal execution
- [ ] Neither detected → normal execution (empty/new project path)
- [ ] **Exempt commands** (never blocked): `setup`, `update`, `version`, `help`, `init` (empty directory)
- [ ] **Directory traversal**: detection walks from `pwd` upward to git root (or filesystem root)
- [ ] Clear, bilingual error message with migration instructions

---

## US-ONBOARD-005: Roll 自身 dogfood migrate

Execute migration on Roll's own repository + publish major version.

**Acceptance Criteria:**
- [ ] `roll migrate` executed on Roll repo, single commit
- [ ] All test files updated to new paths (`npm test` passes — all 377+ tests green)
- [ ] All skill SKILL.md files updated to new paths
- [ ] All template/conventions files updated to new paths
- [ ] AGENTS.md §8 (Documentation Conventions) rewritten for new structure
- [ ] `package.json` version bumped to 2.0.0
- [ ] `package.json` name updated to lowercase `roll` (if applicable)
- [ ] GitHub repo renamed from `Roll` to `roll` (`gh repo rename roll`)
- [ ] `.roll/` content verified as self-contained (no outward relative paths)
- [ ] CI green on the migration PR before npm publish
- [ ] 1.x final version published first with deprecation notice

---

## US-ONBOARD-010: 迁移指南和用户文档

Documentation for existing users to understand and perform the migration.

**Acceptance Criteria:**
- [ ] `guide/en/migration-2.0.md` — step-by-step migration guide for existing Roll users
- [ ] `guide/zh/migration-2.0.md` — Chinese mirror
- [ ] `guide/en/legacy-onboarding.md` — guide for onboarding legacy projects
- [ ] `guide/zh/legacy-onboarding.md` — Chinese mirror
- [ ] FAQ section covering: "what if I don't want to migrate", "can I undo", "what about my git history"
- [ ] README updated with migration notice for 2.0
