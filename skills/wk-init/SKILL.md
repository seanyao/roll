---
name: wk-init
description: Initialize a new AI-Coding project with complete WK workflow support. Detects existing project state and adapts: full scaffold for new projects, smart adoption for legacy projects, refresh for already-WK projects.
---

# Project Init

Unified entry for all project initialization scenarios. Detects current state first, then acts accordingly.

## When to Use

- Starting a brand-new project
- Onboarding a legacy project into WK workflow
- Refreshing or completing an existing WK setup

---

## Step 1: Detect Project State

Before doing anything, scan the current directory and determine which situation applies:

**Check for WK convention files:**
```bash
ls AGENTS.md .claude/CLAUDE.md GEMINI.md .cursor-rules 2>/dev/null
```

**Check for existing code/structure:**
```bash
ls -la | head -30
# Look for: src/, app/, lib/, package.json, go.mod, Cargo.toml, requirements.txt, etc.
```

**Read tech stack indicators:**
- `package.json` → Node.js / framework (React, Express, Next.js, etc.)
- `go.mod` → Go
- `Cargo.toml` → Rust
- `requirements.txt` / `pyproject.toml` → Python
- `pom.xml` / `build.gradle` → Java

---

## Step 2: Decide Mode Based on Detection

### Situation A: Empty / New Project

No existing code, no convention files.

→ Proceed directly to **Full Scaffold Mode** (no questions needed). Ask only:
1. Project type (fullstack / frontend-only / backend-service / cli)
2. AI tools to use (claude / gemini / cursor / all)

### Situation B: Legacy Project (has code, no WK conventions)

Has existing directory structure and/or source files, but no AGENTS.md.

→ Show a brief summary of what was detected, then ask:

```
Detected: Node.js / Express / TypeScript
Structure: src/controllers/, src/services/, tests/

How would you like to proceed?
1) Merge (recommended) — keep your structure, add WK conventions + workflow files, document your actual paths in AGENTS.md
2) Keep — only add convention files, nothing else
3) Overwrite — replace with WK standard structure (destructive, confirm required)
```

### Situation C: Already Has WK Convention Files

AGENTS.md or .claude/CLAUDE.md already exists.

→ Show current status, then ask:

```
Found existing WK setup:
  ✓ AGENTS.md
  ✓ .claude/CLAUDE.md
  ✗ BACKLOG.md (missing)

What would you like to do?
1) Refresh — regenerate convention files from latest templates
2) Complete — add only what's missing
3) Skip — do nothing
```

---

## Step 3: Handle Convention Files

For each file (AGENTS.md / .claude/CLAUDE.md / GEMINI.md / .cursor-rules):

| File state | Action |
|------------|--------|
| Does not exist | Create directly |
| Exists, content identical | Skip silently |
| Exists, content differs | Ask: **Overwrite / Keep / Merge** |

**Merge** = keep the existing content as-is, append any WK sections that are missing at the bottom.

Run `wukong init [type]` to generate convention files and scaffold the project structure.
The CLI handles both new and legacy projects — no manual file creation needed.

---

## Step 4A: Full Scaffold Mode (new projects)

**Delegated to CLI** — `wukong init` detects a fresh directory and offers to scaffold automatically:

```
  Scaffold fullstack project structure? [Y/n]:
```

The CLI creates the following structure per project type:

| Type | Created |
|------|---------|
| fullstack | `src/` (components/ui, domains, shared), `api/` (routes, services, models), `tests/`, `docs/`, BACKLOG.md, .env.example, .gitignore |
| frontend-only | `src/`, `tests/`, `docs/`, BACKLOG.md, .env.example, .gitignore |
| backend-service | `api/`, `tests/`, `docs/`, BACKLOG.md, .env.example, .gitignore |
| cli | `cmd/`, `lib/`, `tests/`, `docs/`, BACKLOG.md, .gitignore |

Each directory gets a `.gitkeep` so it appears in git. Template files (BACKLOG.md, .env.example) get starter content.

---

## Step 4B: Merge Mode (legacy projects)

**Delegated to CLI** — `wukong init` detects existing source code and enters interactive scaffold mode, asking y/N per component with benefit labels:

```
  Add BACKLOG.md  (track stories & bugs in one place)  [Y/n]:
  Add docs/features/  (design docs live next to code)  [Y/n]:
  Add tests/ scaffold  (unit/ e2e/ structure ready to fill)  [Y/n]:
  Add .env.example  (document required env vars for teammates)  [Y/n]:
  Add .github/workflows/ci.yml  (automated CI on every push)  [Y/n]:
  Add .github/workflows/sentinel.yml  (scheduled patrol every 6h)  [Y/n]:
```

Do NOT touch existing source code or directory structure.

For legacy projects, also scan and append a `## Project Structure` block to AGENTS.md:
1. Scan existing directory structure (depth ≤ 3, exclude node_modules/.git/dist/build)
2. Append a `## Project Structure` block to AGENTS.md (update if already exists, don't duplicate):

```markdown
## Project Structure (detected by $wk-init)

Tech stack: <detected stack>

Key paths:
- <actual-path>/   <role description>
- <actual-path>/   <role description>
...

Commands:
  dev:   <from package.json scripts.dev or equivalent>
  build: <from package.json scripts.build or equivalent>
  test:  <from package.json scripts.test or equivalent>
```

5. Create BACKLOG.md if missing (empty template)
6. Create docs/plans/ directory if missing
7. Do NOT create src/, api/, tests/ or other source directories

---

## Workflow Reference

```
Design → Build → Check → Fix → Continuous cycle

Design:  $wk-design      → docs/plans/ + BACKLOG.md
Build:   $wk-story-build → TCR → CI/CD → Deploy
Check:   $wk-sentinel    → Scheduled patrol → Discover issues
Fix:     $wk-fix-build   → TCR → Deploy → Verify
```

---

## File References

### BACKLOG.md

```markdown
# Project Backlog

## 🎯 Active
| ID | Title | Status | Priority | Est |
|----|-------|--------|----------|-----|

## 📋 Todo
## ✅ Completed
## 🐛 Bug Fixes
| ID | Problem | Status | Source |
|----|---------|--------|--------|

## 🔍 Sentinel Findings
| ID | Issue | Severity | Status |
|----|-------|----------|--------|
```

### .env.example

```bash
# AI Services
KIMI_API_KEY=sk-your-kimi-api-key
OPENAI_API_KEY=sk-your-openai-key

# Cloud Storage
OSS_ACCESS_KEY_ID=your-access-key
OSS_ACCESS_KEY_SECRET=your-secret
OSS_BUCKET=your-bucket
OSS_REGION=oss-cn-hangzhou

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-jwt-secret-key
```

### vercel.json

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ]
}
```

### .github/workflows/sentinel.yml

```yaml
name: Sentinel Patrol
on:
  schedule:
    - cron: '0 */6 * * *'
jobs:
  patrol:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: $wk-sentinel patrol --mode=normal
```

---

## Quick Commands Reference

| Phase | Command | Purpose |
|-------|---------|---------|
| Plan | `$wk-design "requirement"` | Plan design, split into Stories |
| Do | `$wk-story-build US-XXX` | Develop a Story |
| Do | `$wk-fix-build FIX-XXX` | Fix a Bug |
| Do | `$wk-roll-build "one-liner"` | Quick implementation |
| Check | `$wk-sentinel patrol` | Scheduled patrol |
| Check | `$wk-bb-debug URL` | Deep diagnosis |

---

## Conventions

- All work tracked in BACKLOG.md
- Sentinel patrols every 6 hours
- TCR required for all changes
- AGENTS.md is the single source of truth for architecture constraints
