# CNX Command Quick Reference

**Unified AI-Coding workflow entry point** - Complete toolchain for structured software development

---

## Getting Started

```bash
$cnx <command> [options]
```

---

## Command Overview

| Command | Purpose | Scenario |
|------|------|------|
| `backlog` | Requirement planning | New feature design, split into Stories |
| `build` | Execute Story | Develop specific features |
| `fix` | Fix Bug | Quick issue fixes |
| `roll` | One-sentence delivery | Simple requests, fast implementation |
| `review` | Code review | Check code quality |
| `fetch` | Single page scrape | Get single webpage content |
| `crawl` | Full site crawl | Bulk scrape websites |
| `probe` | Node check | Discover machines, health diagnosis |
| `init` | Initialize project | Create new project structure |
| `changelog` | Generate changelog | Pre-release update log |

---

## Usage Examples

### 📝 Plan - Planning Phase

```bash
# Plan a new feature, automatically split into Stories
$cnx backlog "user login system"

# Plan from an existing design document
$cnx backlog --from-plan docs/plans/auth.md

# Directly create a single Story
$cnx backlog --story "add password reset feature"
```

### 🔨 Do - Execution Phase

```bash
# Execute a specified Story
$cnx build US-001

# Quick bug fix
$cnx fix "login button click unresponsive"

# One-sentence quick delivery (auto plan + execute)
$cnx roll "add dark mode toggle"
```

### 👀 Check - Review Phase

```bash
# Code review
$cnx review

# Scrape technical docs for reference
$cnx fetch https://docs.example.com/api

# Crawl competitor website for analysis
$cnx crawl https://competitor.com --depth 2
```

### 🚀 Act - Deployment Phase

```bash
# Generate changelog
$cnx changelog

# Check production environment nodes
$cnx probe health production.local
```

---

## Scenario Comparison

### fetch vs crawl

| Scenario | Command | Description |
|------|------|------|
| Read a single article | `$cnx fetch <url>` | Single page extraction, fast retrieval |
| Back up an entire doc site | `$cnx crawl <url>` | Full site recursive, bulk save |
| Get API docs | `$cnx fetch` | Fetch current page at once |
| Competitor website analysis | `$cnx crawl` | Deep crawl across multiple pages |

### build vs fix vs roll

| Scenario | Command | Description |
|------|------|------|
| Develop a planned feature | `$cnx build US-001` | Execute existing Story |
| Fix a production Bug | `$cnx fix "description"` | Quick fix workflow |
| Ad-hoc small request | `$cnx roll "description"` | Auto-plan and execute |

---

## Full Workflow Example

```bash
# 1. Plan requirements -> generate US-001
$cnx backlog "user login feature"

# 2. Execute development -> TCR workflow
$cnx build US-001

# 3. Code review
$cnx review

# 4. Release
$cnx changelog
```

---

## Environment Requirements

- Node.js 18+
- Project directory must contain `BACKLOG.md`
- Git repository (for TCR workflow)

## Project Structure

```
project/
├── BACKLOG.md          # Story backlog
├── CHANGELOG.md        # Release history
├── docs/
│   └── plans/          # Design plans
└── .github/
    └── workflows/      # CI/CD
```
