---
hidden: true
name: roll-.dream
license: MIT
allowed-tools: "Read, Glob, Grep, Bash(git:*), Write, Edit"
description: |
  Nightly code and architecture health scan. Passively triggered by scheduler
  (cron or GitHub Actions), not invoked by users directly. Detects dead code,
  architectural drift from domain model, pruning candidates, emerging patterns,
  doc coverage gaps, and doc staleness (文档新鲜度). Outputs REFACTOR entries
  to BACKLOG.md and a daily log to docs/dream/.
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

Run all six scans every night. Each scan is independent.

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

**Distinction from Scan 6C**: Scan 2 flags *import boundary violations* (cross-context coupling). Scan 6C flags *missing documentation entries* (module exists but has no entry in `docs/domain/*.md`). Never double-flag — Scan 2 and Scan 6C are orthogonal checks.

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

### Scan 6 — 文档新鲜度 (Doc Freshness)

**Dependency gate**: Skip Scan 6 entirely when `$roll-doc` (US-SKILL-008) is not yet deployed.
Check: `[ -f "$ROLL_HOME/skills/roll-doc/SKILL.md" ]`. If absent, log "Scan 6 skipped — roll-doc not deployed" in the dream log and stop. No fallback.

When deployed, each finding produces a REFACTOR entry with `$roll-doc` as execution hint:
```markdown
| REFACTOR-XXX | docs: <description> — flagged by dream <date> (hint: $roll-doc) | 📋 Todo |
```

#### Check A — Stale Docs

Flag source files whose owning doc is >30 days stale:

```bash
# For each file listed in docs/features/*.md or README.md "## Files:" sections:
#   owner_doc_commit = git log -1 --format="%ci" -- <doc_file>
#   source_commit    = git log -1 --format="%ci" -- <source_file>
#   lag_days = (source_commit - owner_doc_commit) in days
#   if lag_days > 30 AND doc contains at least one specific file path reference → flag
```

The "owner doc" for a source file is the nearest `README.md` or `docs/features/*.md` that lists the file path in a `## Files:` section. Skip docs that contain only conceptual descriptions (no specific file path references) — they cannot be objectively stale.

#### Check B — Undocumented ENV Vars

Flag environment variables that appear frequently in source but have no documentation:

```bash
# Detect ENV var patterns in non-test source files:
patterns=(
  'process\.env\.[A-Z_]+'        # Node.js
  'os\.getenv\("[A-Z_]+"\)'      # Python
  'ENV\["[A-Z_]+"\]'             # Ruby
)
# For each matched variable name:
#   count occurrences across all source files
#   if count >= 5 AND zero mentions in any .md file → flag
```

Flag variables appearing ≥5× in source with zero mentions in any `.md`.
"Other convention signals" (comment clusters, module structure templates) are explicitly deferred — too vague for deterministic detection.

#### Check C — Existence Drift

Find module directories that exist in code but are absent from architecture docs.
This is distinct from Scan 2 (which checks *import violations*) — Scan 6C checks *documentation existence*:

```bash
# Walk all non-excluded directories
# For each dir with >= 3 non-hidden, non-.md source files:
#   check if any docs/domain/*.md contains the directory name
#   if not found → flag as "existence drift"
```

Exclusions: `node_modules/`, `.git/`, `dist/`, `build/`, `.shared/`, `docs/`, `tests/`.

Flag directories with ≥3 source files and zero name-match in `docs/domain/*.md`.

#### Dream Log Section

Add after `## 文档覆盖度` section:

```markdown
## 文档新鲜度
- 滞后文档：{N} 个（超过 30 天未更新但绑定了代码文件）
- 未记录 ENV 变量：{N} 个（出现 ≥5 次但无文档）
- 架构文档缺失模块：{N} 个（≥3 个源文件的目录未出现在 docs/domain/）
{发现内容列表 或 "文档新鲜度良好，无滞后或缺失项。"}
```

## Output

### REFACTOR Entry (BACKLOG.md)

For each finding that warrants action, append one row to the `## ♻️ Refactor`
section of BACKLOG.md:

```markdown
| REFACTOR-XXX | {one-line description} — flagged by dream {YYYY-MM-DD} | 📋 Todo |
```

`{one-line description}` 写法：一句人话说清楚"什么地方需要改"以及"不改会怎样"。不写函数名、文件路径、技术方案。例：`loop 状态读取逻辑分散在多处，修一处容易遗漏另一处`。

**Threshold**: only flag items where the fix would meaningfully reduce
complexity or prevent future bugs. Ignore cosmetic issues.

### Dream Log (docs/dream/YYYY-MM-DD.md)

Always write a log, even when no REFACTOR entries are created. Output uses
Chinese to align with roll-brief style — easier for the morning reader to scan
without context switching:

```markdown
# Dream Log {YYYY-MM-DD}

## 概要
- 扫描项：死代码 / 架构漂移 / 裁剪候选 / 新兴模式 / 文档覆盖度 / 文档新鲜度
- 发现：{N} 项标记，{M} 个 REFACTOR 条目已创建

## 死代码
{发现内容 或 "未发现死代码。"}

## 架构漂移
{发现内容 或 "未发现架构漂移。"}

## 裁剪候选
{发现内容 或 "未发现可裁剪项。"}

## 新兴模式
{发现内容 或 "未发现可提取的重复模式。"}

## 文档覆盖度
{发现内容 或 "文档结构符合规范，无缺口。"}

## 文档新鲜度
- 滞后文档：{N} 个
- 未记录 ENV 变量：{N} 个
- 架构文档缺失模块：{N} 个
{发现内容 或 "文档新鲜度良好，无滞后或缺失项。"}

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
