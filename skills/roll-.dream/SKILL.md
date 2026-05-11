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

### Scan 5 — Doc Coverage Check

Check documentation structure against the conventions in `AGENTS.md § Documentation Conventions`.

**Check A — BACKLOG Done stories missing guide/en/ docs:**

Scan BACKLOG.md for features with multiple ✅ Done stories. For each feature epic, check whether a corresponding `docs/guide/en/<topic>.md` exists. If a feature has ≥3 Done stories and no guide doc, flag it.

**Check B — guide/en/ files missing guide/zh/ translations:**

```bash
for f in docs/guide/en/*.md; do
  base=$(basename "$f")
  [ ! -f "docs/guide/zh/$base" ] && echo "missing ZH: $base"
done
```

Flag any `docs/guide/en/<topic>.md` that has no matching `docs/guide/zh/<topic>.md`, provided the EN file has existed since before the most recent git tag (i.e., at least one release cycle old).

**Check C — stray files in docs/ root (根目录散落文件):**

```bash
find docs/ -maxdepth 1 -name '*.md' 2>/dev/null
```

Flag any `.md` file directly in `docs/` root (allowed subdirs: `guide/`, `domain/`, `features/`, `practices/`, `briefs/`, `dream/`).

**REFACTOR entry format for doc findings:**

```markdown
| REFACTOR-XXX | docs: {具体缺口描述} — flagged by dream {YYYY-MM-DD} | 📋 Todo |
```

**Dream log section** — add after existing sections:

```markdown
## 文档覆盖度
{发现内容 或 "文档结构符合规范，无缺口。"}
```

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

Always write a log, even when no REFACTOR entries are created. Output uses
Chinese to align with roll-brief style — easier for the morning reader to scan
without context switching:

```markdown
# Dream Log {YYYY-MM-DD}

## 概要
- 扫描项：死代码 / 架构漂移 / 裁剪候选 / 新兴模式 / 文档覆盖度
- 发现：{N} 项标记，{M} 个 REFACTOR 条目已创建

## 死代码
{发现内容 或 "未发现死代码。"}

## 架构漂移
{发现内容 或 "未发现架构漂移。"}

## 裁剪候选
{发现内容 或 "未发现可裁剪项。"}

## 新兴模式
{发现内容 或 "未发现可提取的重复模式。"}

## 创建的 REFACTOR 条目
{列表 或 "无。"}
```

### Commit

扫描完成后立即提交，把 dream 发现纳入 git 历史，便于晨报追溯：

```bash
git add BACKLOG.md docs/dream/YYYY-MM-DD.md
# 有 REFACTOR 条目时：
git commit -m "chore: dream scan YYYY-MM-DD — {N} REFACTOR entries"
# 无发现时：
git commit -m "chore: dream scan YYYY-MM-DD — no findings"
```

- BACKLOG.md 和 dream 日志必须在**同一个 commit** 里入库，避免出现"REFACTOR 已加但日志找不到"或反过来的撕裂状态
- 写文件失败时不要执行 commit；保持工作区干净，由调度器负责重试
- 仅 `BACKLOG.md` 和 `docs/dream/YYYY-MM-DD.md` 入 commit，不要顺带带入其他无关变更

## Scheduler Configuration

roll-.dream runs **locally** — it reads the local codebase directly.

### Local cron (default)

Installed automatically via `roll loop on` alongside roll-loop and roll-brief.
The cron entry is generated using the configured agent — no manual cron editing needed.

## Failure Handling

If the scan fails partway through:

1. Write partial results to `docs/dream/YYYY-MM-DD.md` with a `## 状态：部分完成` header
2. Do not write incomplete REFACTOR entries to BACKLOG
3. Log the error to `~/.shared/roll/dream/error.log`

The scheduler (not this skill) is responsible for retry and human notification.
