---
hidden: true
name: roll-.changelog
license: MIT
allowed-tools: "Read, Edit, Write, Bash(git:*)"
description: After build completion, extracts completed Stories from BACKLOG.md to generate CHANGELOG.md. Auto-triggered after successful deploy, keeping the external changelog in sync with the internal backlog.
---

# WK Generate Changelog

After successful Build & Deploy, extracts completed Stories from BACKLOG.md to generate a user-friendly `CHANGELOG.md`.

## When Triggered

- **Auto-triggered**: After successful deploy of `$roll-build` or `$roll-fix`
- **Manual trigger**: When user requests "update changelog" or "generate release notes"

## When Not to Use

- Generating commit messages or PR descriptions — this skill only runs post-deploy
- Recording dev diary / moments (use `$roll-notes`)
- Bumping package version (use `$roll-release`)

## Workflow

### 1. Check CHANGELOG.md

```
CHANGELOG.md exists?
    ├── Yes → Append mode (add current deploy's changes)
    └── No  → Create mode (backfill all historical completed Stories)
```

### 2. Read BACKLOG.md

```
Append mode:
  Extract only the Story/Fix just deployed in this session.

Create mode:
  Extract ALL Stories and Fixes with status ✅ Done.
  Read each Story's docs/features/<feature>.md for Completed date.
  Group entries by completion date, reverse chronological order.
```

### 3. Filter for External Content

**Remove internal information:**
- Progress tables, completion percentages
- "As a / I can / So that" format
- Detailed AC checklists
- Technical debt, internal file paths
- Test case counts, architecture diagrams

**Keep user-facing value:**
- New features (one-sentence description)
- Bug fixes (user-visible impact)
- UX improvements (layout, interaction enhancements)
- Performance/reliability improvements

**语言：中文。** 所有 changelog 条目必须用中文撰写。

**Description format:** `功能名 — 做了什么 + 用在什么场景`，一句话，精简。

Good:
```
- **Added**: roll-jot — 一句话快速记录 bug 或想法到 backlog，不打断当前工作
- **Fixed**: 同步时清理已删除文件，防止用户机器残留幽灵文件
```

Bad:
```
- **Added**: Add roll-jot skill for fast backlog capture
- **Fixed**: Sync prunes stale files to prevent ghost files
```

### 4. Version Number Format

```
YYYY.MM.DD
YYYY.MM.DD-1  (multiple releases on the same day)
YYYY.MM.DD-2
```

### 5. Generate CHANGELOG.md

**Create mode** (first time):
```markdown
# Changelog

## 2026.05.10
- **Added**: <latest completed feature>
- **Fixed**: <latest resolved bug>

## 2026.05.04
- **Added**: <earlier completed feature>

## 2026.04.28
- ...
```

**Append mode** (subsequent):
```markdown
# Changelog

## 2026.05.10    ← new entry prepended at top
- **Added**: <just-deployed feature>

## 2026.05.04    ← existing entries unchanged
- ...
```

**Ordering**: Most recent version first (reverse chronological)

### 6. Commit Update

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for release $(date +%Y.%m.%d)"
git push
```

## Integration

After successful deploy in `$roll-build` / `$roll-fix`:

```markdown
**Post-Deploy:**
- `$roll-.changelog` - Sync external changelog
```
