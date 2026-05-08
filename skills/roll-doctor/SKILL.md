---
name: roll-doctor
license: MIT
allowed-tools: "Read, Bash, Edit"
description: "Diagnose Roll toolchain health. Checks skill files, YAML frontmatter, symlinks, conventions sync, template integrity, and config validity."
---

# Roll Doctor

诊断 Roll 工具链健康状态。快速定位 skill 不工作、convention 不同步、symlink 断裂等问题。

## When to Use

- "roll 怎么不工作了"
- "skill 找不到了"
- "convention 没有同步"
- "$roll-debug 不响应"
- 任何 Roll 相关功能异常

## Checks

### 1. Roll Installation

```bash
# Verify ROLL_HOME structure
ls -la ~/.roll/
ls -la ~/.roll/skills/
ls -la ~/.roll/conventions/
```

Expected:
- `~/.roll/` exists
- `~/.roll/skills/` has roll-* directories
- `~/.roll/conventions/global/` has AGENTS.md, CLAUDE.md, etc.
- `~/.roll/conventions/templates/` has backend-service, cli, frontend-only, fullstack

### 2. Skill Health

```bash
# List all skills and check YAML frontmatter
for f in ~/.roll/skills/*/SKILL.md; do
  echo "=== $(basename $(dirname $f)) ==="
  head -5 "$f"
done
```

Check:
- Each skill directory has `SKILL.md`
- YAML frontmatter has `name:` and `description:`
- No duplicate `name` values across skills
- File is readable markdown

### 3. Symlinks

```bash
# Claude Code
ls -la ~/.claude/skills/roll-*

# Gemini (if exists)
ls -la ~/.gemini/skills/roll-* 2>/dev/null

# Trae (if exists)
ls -la ~/.trae/skills/roll-* 2>/dev/null
```

Check:
- Each symlink exists
- Each symlink points to valid target in `~/.roll/skills/`
- No broken symlinks (red in ls output)

### 4. Conventions Sync

```bash
# Check roll.md sync
diff ~/.roll/conventions/global/CLAUDE.md ~/.claude/roll.md

# Check CLAUDE.md includes @roll.md
grep "@roll.md" ~/.claude/CLAUDE.md
```

Check:
- `~/.claude/roll.md` exists and matches `~/.roll/conventions/global/CLAUDE.md`
- `~/.claude/CLAUDE.md` contains `@roll.md` reference
- `~/.claude/CLAUDE.md` is not missing or stale

### 5. Template Integrity

```bash
# Global conventions
ls ~/.roll/conventions/global/

# Project type templates
for t in backend-service cli frontend-only fullstack; do
  ls ~/.roll/conventions/templates/$t/
done

# New project template
ls ~/.roll/template/
```

Check:
- All expected files present in each directory
- No missing AGENTS.md, CLAUDE.md, or GEMINI.md

### 6. Config

```bash
cat ~/.roll/config.yaml
```

Check:
- File exists and is valid YAML
- Has required `ai_tool_name` or `ai_claude` entries

### 7. Peer Review

```bash
# Peer state directory
ls -la ~/.roll/.peer-state/ 2>/dev/null || echo "missing"

# Peer config in config.yaml
grep "peer_" ~/.roll/config.yaml 2>/dev/null || echo "no peer config"

# Available peer CLIs
for tool in claude kimi pi codex; do
  command -v "$tool" &>/dev/null && echo "✓ $tool" || echo "✗ $tool"
done

# roll-peer skill
ls ~/.roll/skills/roll-peer/SKILL.md 2>/dev/null || echo "missing"
```

Check:
- `~/.roll/.peer-state/` exists and is writable
- `~/.roll/config.yaml` contains `peer_call_timeout` (default: 180)
- At least one peer CLI (claude / kimi / pi) is installed
- `roll-peer` skill exists

## Report Format

```
🔬 Roll Doctor Report

[✓/✗] Roll installation
[✓/✗] Skills (N skills checked)
[✓/✗] Symlinks (N tools checked)
[✓/✗] Conventions sync
[✓/✗] Templates integrity
[✓/✗] Config
[✓/✗] Peer Review

---
Issues found: N

1. [severity] description → fix command
2. [severity] description → fix command

Recommendation: ...
```

## Severity Levels

| Level | Meaning | Example |
|-------|---------|---------|
| 🔴 Critical | Skill completely broken | Broken symlink, missing SKILL.md |
| 🟡 Warning | Partial functionality | Stale convention, outdated roll.md |
| 🟢 Info | Recommendations | Missing optional tool symlink |

## Auto-Fix

If user confirms, automatically fix safe issues:

- **Broken/missing symlinks** → `roll setup` (recreates all)
- **Stale conventions** → `roll sync conventions`
- **Missing template files** → warn user to re-install

Never auto-fix without user confirmation for:
- Overwriting `~/.claude/CLAUDE.md` (may have user customizations)
- Deleting files

## Quick Fix Commands

```bash
# Recreate all symlinks and sync conventions
roll setup

# Sync only conventions
roll sync conventions

# Reinstall (nuclear option)
curl -fsSL https://raw.githubusercontent.com/seanyao/roll/main/install.sh | bash
```
