# Path Audit — US-ONBOARD-002 Deliverable

> Snapshot date: 2026-05-19
> Audited against commit: 7f41838394d9887a5586f47afe5b0bfaefc880f0
> Branch: worktree-legacy-onboard-epic
>
> **This is the authoritative reference for all path replacements in Stories 3-5.**

## Summary

| Area | Literal hits | Files with hits | Files with variables |
|------|--------------|-----------------|----------------------|
| bin/roll | 52 | 1 | 1 |
| skills/*/SKILL.md | 163 | 13 | 1 |
| tests/ | 186 | 35 | 11 |
| conventions/ | 22 | 5 | 0 |
| lib/ | 18 | 6 | 6 |
| hooks/ | 0 | 0 | 0 |
| scripts/ | 21 | 1 | 1 |
| template/ | 2 | 1 | 0 |
| templates/ | 0 | 0 | 0 |
| **TOTAL** | **464** | **62** | **20** |

Total `rg -n` hits across all audit targets: **464** (verified by `rg -n "<pattern>" bin/roll skills/ tests/ conventions/ lib/ hooks/ scripts/ template/ templates/ | wc -l`).

## Files that actually exist (need physical migration)

Verified via `find docs/ -type f` and `ls`:

| Old path | File/dir count | Target |
|----------|----------------|--------|
| `BACKLOG.md` | 1 file (root) | `.roll/backlog.md` |
| `PROPOSALS.md` | 1 file (root) | `.roll/proposals.md` |
| `docs/features.md` | 1 file | `.roll/features.md` |
| `docs/features/` | 43 files | `.roll/features/` |
| `docs/briefs/` | 10 files | `.roll/briefs/` |
| `docs/dream/` | 7 files | `.roll/dream/` |
| `docs/design/` | 4 files | `.roll/design/` |
| `docs/domain/` | 3 files | `.roll/domain/` |
| `docs/practices/` | 2 files | split: `engineering-common-sense.md` → `guide/{en,zh}/practices/`; `loop-autorun-verification.md` → `.roll/verification/` |
| `docs/intro/` | 2 files | `site/slides/` |
| `docs/guide/` | 30 files (15 en + 15 zh) | `guide/` (root level) |
| `docs/site/` | 8 files | `site/` |
| `docs/INDEX.md` | does NOT exist on this branch | code-only refs; future-generated artifact |

Notes:
- Root `BACKLOG.md` and `PROPOSALS.md` are both real files at repo root.
- `docs/INDEX.md` is referenced in `skills/roll-doc/SKILL.md` and 1 test, but no file exists — it is a derived artifact produced by the `roll-doc` skill.
- Hidden `docs/design/` directory exists with 4 files including this epic spec (`legacy-onboard-epic.md`, `legacy-onboard-execution-plan.md`, `idea-023-loop-health-dashboard.md`, `idea-024-upstream-cli-watch.md`).

## Area 1: bin/roll

52 literal hits, 1 variable-based path (`briefs_dir`). Direction taxonomy: read = path used in `[[ -f ]]` / grep / cat; write = `>`, `sed`, `mv`; display = printed in help/echo; comment = `#` line.

### Literal references

| Line | Direction | Migration | Content (truncated) |
|------|-----------|-----------|---------------------|
| 916 | comment | — | `# Fresh project: creates AGENTS.md + BACKLOG.md + docs/features/` |
| 937 | write | needs-file-migration | `_write_backlog "$project_dir/BACKLOG.md"` (call site) |
| 938 | write | needs-file-migration | `_ensure_features_dir "$project_dir/docs/features"` |
| 939 | write | needs-file-migration | `_write_features_md "$project_dir/docs/features.md"` |
| 1022 | comment | — | `# ─── Helper: write starter BACKLOG.md (no-op if exists) ───` |
| 1025 | display | — | `_ROLL_MERGE_SUMMARY+=("unchanged|BACKLOG.md")` |
| 1039 | display | — | `ok "Created: BACKLOG.md"` |
| 1040 | display | — | `_ROLL_MERGE_SUMMARY+=("created|BACKLOG.md")` |
| 1045 | display | — | `_ROLL_MERGE_SUMMARY+=("unchanged|docs/features/")` |
| 1050 | display | — | `ok "Created: docs/features/"` |
| 1051 | display | — | `_ROLL_MERGE_SUMMARY+=("created|docs/features/")` |
| 1054 | comment | — | `# ─── Helper: write starter docs/features.md (no-op if exists) ───` |
| 1057 | display | — | `_ROLL_MERGE_SUMMARY+=("unchanged|docs/features.md")` |
| 1072 | display | — | `ok "Created: docs/features.md"` |
| 1073 | display | — | `_ROLL_MERGE_SUMMARY+=("created|docs/features.md")` |
| 1253 | read | needs-file-migration | `[[ -z "$path_note" && -f "${proj_path}/BACKLOG.md" ]]` |
| 1254 | read | needs-file-migration | `todo_count=$(grep -c '📋 Todo' "${proj_path}/BACKLOG.md" ...)` |
| 2504 | read | needs-file-migration | Heredoc: `git diff origin/main -- BACKLOG.md ... \[A-Z]+-[0-9]+\] ...` |
| 2854 | comment | — | `# Edit files (docs/dream/, docs/briefs/, BACKLOG, etc.)` |
| 3366 | read | needs-file-migration | `[[ -f "$project_path/BACKLOG.md" ]] && _LOOP_RUNS_BACKLOG=$(cat "$project_path/BACKLOG.md")` (both `-f` test and `cat`) |
| 3674 | comment | — | `# On failure: reverts story in BACKLOG.md to 📋 Todo and writes ALERT.` |
| 3685 | read | needs-file-migration | `if [[ -f "BACKLOG.md" ]]; then` (inside `_loop_enforce_tcr`) |
| 3687 | both | needs-file-migration | `sed "/\[${story_id}\]/s/ \| ✅ Done \|/ \| 📋 Todo \|/" BACKLOG.md > "$tmp"` |
| 3688 | write | needs-file-migration | `&& mv "$tmp" BACKLOG.md` |
| 4075 | read | code-only | `"repos/${slug}/contents/BACKLOG.md?ref=${branch}"` — GitHub API URL fetching BACKLOG.md from a PR head (see Special Cases) |
| 4514 | comment | — | `# (BACKLOG.md, CHANGELOG.md, PROPOSALS.md, docs/, .claude/).` |
| 4520 | read | needs-file-migration | `echo "$changed" \| grep -qvE '^(BACKLOG\.md\|CHANGELOG\.md\|PROPOSALS\.md\|docs/\|\.claude/)'` (regex matches paths via `git diff --name-only`) |
| 4680 | display | — | `echo "    BACKLOG.md not found"` |
| 4751 | read | needs-file-migration | `latest=$(ls "${briefs_dir}"/*.md ...)` (via `briefs_dir` var) |
| 4756 | read | needs-file-migration | `latest=$(ls "${briefs_dir}"/*.md ...)` |
| 4764 | read | needs-file-migration | `latest=$(ls "${briefs_dir}"/*.md ...)` |
| 4952 | display | — | `err "BACKLOG.md not found — run 'roll init' first  未找到 BACKLOG.md，请先运行 roll init"` |
| 5098 | comment | — | `# ② Loop layer: extract in-progress story id\|title\|feature-link from BACKLOG.md.` |
| 5102 | read | needs-file-migration | `[[ -f "BACKLOG.md" ]] \|\| return 0` |
| 5104 | read | needs-file-migration | `row=$(grep -F '\| 🔨 In Progress \|' BACKLOG.md \| head -1)` |
| 5110 | read | code-only | `link=$(echo "$row" \| grep -oE 'docs/features/[^)]+' ...)` (regex pattern parses link target out of BACKLOG row — see Special Cases) |
| 5143 | read | needs-file-migration | `[[ -f "BACKLOG.md" ]] \|\| { echo 0; return; }` |
| 5144 | read | needs-file-migration | `grep -E '^\| REFACTOR-' BACKLOG.md 2>/dev/null \| ...` |
| 5164 | read | needs-file-migration | `[[ -f "BACKLOG.md" ]] \|\| { echo "0 0 0 0 0"; return; }` |
| 5166 | read | needs-file-migration | `idea=$(grep -E '^\| IDEA-' BACKLOG.md ...)` |
| 5167 | read | needs-file-migration | `backlog=$(grep -E '^\| (\[?US-\|FIX-\|REFACTOR-)' BACKLOG.md ...)` |
| 5168 | read | needs-file-migration | `build=$(grep -F '\| 🔨 In Progress \|' BACKLOG.md ...)` |
| 5240 | read | needs-file-migration | `[[ -f "PROPOSALS.md" ]] \|\| { echo 0; return; }` |
| 5241 | read | needs-file-migration | `grep '^## PROPOSAL' PROPOSALS.md 2>/dev/null \| ...` |
| 5259 | read | needs-file-migration | `latest=$(ls docs/briefs/*.md ...)` (in `_dash_release_ready`) |
| 5437 | display | — | `printf "    ${YELLOW}📋 %s PROPOSAL${NC}      see: PROPOSALS.md\n" ...` |
| 5446 | read | needs-file-migration | `latest_brief=$(ls docs/briefs/*.md ...)` |
| 5486 | display | — | `echo "  init   [Project] Create AGENTS.md + BACKLOG.md + docs/  ..."` (legacy help) |
| 5540 | read | needs-file-migration | `"") [[ -f "BACKLOG.md" ]] && _home \|\| { _help; _show_changelog; } ;;` (main entry default) |

Sub-references inside `_backlog_set_status` (line 4819-4950 region — same `local backlog="BACKLOG.md"` variable used). Specifically:

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 4819 | both | needs-file-migration | `local backlog="BACKLOG.md"` (in `_backlog_set_status`) — value flows to Python script that reads + writes the file |
| 4950 | read | needs-file-migration | `local backlog="BACKLOG.md"` (in `cmd_backlog`) — used in `[[ -f "$backlog" ]]` check at 4951 |

### Variable-based references

| Line | Variable | Value | Used in lines | Notes |
|------|----------|-------|---------------|-------|
| 3365 | `_LOOP_RUNS_BACKLOG` | (init `=""`) | 3294, 3366, 3372 | Global var; holds BACKLOG.md *content* (not path). 3366 sets via `cat "$project_path/BACKLOG.md"`. Functional dependency — needs sync with renamed source file. |
| 3728 | `backlog` | `"${2:-BACKLOG.md}"` | 3729 (`[ -f "$backlog" ]`), 3735 (`grep ... "$backlog"`), 3751 (`grep ... "$backlog"`) | Default arg for `_loop_check_depends_on` |
| 3765 | `backlog` | `"${2:-BACKLOG.md}"` | 3766 (`[ -f "$backlog" ]`), 3770 (`grep ... "$backlog"`) | Default arg for `_loop_is_manual_only` |
| 4640 | `backlog` | `"BACKLOG.md"` | 4641 (`[[ -f "$backlog" ]]`), 4644-4646 (grep), 4680 (error) | Used in legacy status output |
| 4750 | `briefs_dir` | `"docs/briefs"` | 4751, 4756, 4764 | Glob for finding latest brief in `cmd_brief` |
| 4819 | `backlog` | `"BACKLOG.md"` | 4820+ (passed to Python heredoc as `sys.argv[3]`) | `_backlog_set_status` — read + write via Python |
| 4950 | `backlog` | `"BACKLOG.md"` | 4951 (existence check), 4952 (error) | `cmd_backlog` entrypoint |
| 5167 | `backlog` (local in `_dash_pipeline_counts`) | (set from `grep ... BACKLOG.md`) | line itself | This is a *count* variable, NOT a path. False-positive on name. |

Note on line 3365 `_LOOP_RUNS_BACKLOG`: variable holds **content** of BACKLOG.md, not a path; but its assignment depends on the literal path at line 3366. When BACKLOG.md moves, line 3366's `cat` target must be updated.

## Area 2: skills/*/SKILL.md

163 hits across 13 of 22 skill files. Most are documentation prose describing the workflow; many appear in code-block examples.

### skills/roll-design/SKILL.md (48 hits)

| Line | Direction | Migration | Content (truncated) |
|------|-----------|-----------|---------------------|
| 5 | display | — | description metadata: `... writes to BACKLOG.md.` |
| 12 | display | — | `write to BACKLOG.md` |
| 19 | display | — | `An existing plan needs to be written into BACKLOG.md` |
| 49 | display | — | `$roll-design --from-plan docs/features/auth-plan.md` |
| 71 | display | — | `→ docs/domain/` |
| 86 | display | — | `无 BACKLOG.md / docs/domain/ 目录` |
| 104 | write | needs-file-migration | `BACKLOG.md  # US index page (status + one-liner + link)` |
| 105 | write | needs-file-migration | `docs/features/` |
| 108 | write | needs-file-migration | `docs/domain/  # DDD domain model` |
| 115 | display | — | `Plan files go in docs/features/<feature>-plan.md (no longer using docs/plans/)` |
| 116 | display | — | `US details go in the corresponding docs/features/<feature>.md` |
| 117 | display | — | `BACKLOG.md only contains index rows` |
| 118 | display | — | `Domain model files go in docs/domain/` |
| 123 | display | — | `Feature file: docs/features/<feature>.md` |
| 124 | display | — | `Plan file: docs/features/<feature>-plan.md` |
| 125 | display | — | `BACKLOG.md index row goes under the corresponding Epic > Feature group` |
| 163 | display | — | `Input: IDEA-NNN identifier from BACKLOG.md` |
| 166 | display | — | `[Read BACKLOG.md IDEA-NNN row]` |
| 257 | display | — | `→ docs/domain/context-map.md` |
| 258 | display | — | `→ docs/domain/ubiquitous-` |
| 289 | display | — | `→ docs/features/<feature>-plan.md` |
| 290 | display | — | `[Greenfield] → docs/domain/<ctx>-` |
| 310 | display | — | `5. Write to BACKLOG.md` |
| 397 | write | — | `写入 docs/domain/context-map.md:` |
| 415 | write | — | `写入 docs/domain/ubiquitous-language.md:` |
| 437 | write | — | `写入 docs/domain/<context>-model.md:` |
| 496 | read | — | `... AGENTS.md has a ## Where to Look section with a docs/domain/ pointer.` |
| 499 | display | — | `Domain model: docs/domain/context-map.md` |
| 505 | display | — | `Skip silently if docs/domain/ does not yet exist` |
| 626 | variable | needs-file-migration | `PLAN_FILE="docs/features/${FEATURE}-plan.md"` |
| 628 | comment | — | `# 3. Append US section in docs/features/<feature>.md (with full AC)` |
| 629 | variable | needs-file-migration | `FEATURE_FILE="docs/features/${FEATURE}.md"` |
| 631 | comment | — | `# 4. Append index row under the corresponding Epic > Feature group in BACKLOG.md` |
| 632 | comment | — | `# \| [US-XXX](docs/features/compiler.md#us-xxx) \| ...` |
| 635 | variable | needs-file-migration | `DOMAIN_DIR="docs/domain/"` |
| 636 | comment | — | `# docs/domain/context-map.md` |
| 637 | comment | — | `# docs/domain/ubiquitous-language.md` |
| 638 | comment | — | `# docs/domain/<context>-model.md` |
| 645 | display | — | `BACKLOG.md index row (only write this one line):` |
| 648 | display | — | `\| [US-{DOMAIN}-{N}](docs/features/<feature>.md#us-{domain}-{n}) \| ...` |
| 651 | display | — | `... 细节和 AC 写在 docs/features/ 里。` |
| 655 | display | — | `US section in docs/features/<feature>.md` |
| 714 | display | — | `\| [US-XXX](docs/features/<feature>.md#us-xxx) \| ...` |
| 715 | display | — | `\| [US-YYY](docs/features/<feature>.md#us-yyy) \| ...` |
| 718 | display | — | `Note: BACKLOG.md only contains index rows; full AC ... go in docs/features/<feature>.md.` |
| 766 | read | — | `Check existing domain model — if docs/domain/ exists, read context-map.md` |

Variable-based:
- Line 626: `PLAN_FILE="docs/features/${FEATURE}-plan.md"` — bash variable in skill code block
- Line 629: `FEATURE_FILE="docs/features/${FEATURE}.md"`
- Line 635: `DOMAIN_DIR="docs/domain/"`

### skills/roll-.dream/SKILL.md (28 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 11 | display | — | `to BACKLOG.md and a daily log to docs/dream/.` |
| 59 | read | — | `Compare current code structure against the domain model in docs/domain/:` |
| 72 | display | — | `... module exists but has no entry in docs/domain/*.md` |
| 109 | read | — | `... check whether a corresponding docs/guide/en/<topic>.md exists` |
| 114 | read | needs-file-migration | `for f in docs/guide/en/*.md; do` (executable bash example) |
| 116 | read | needs-file-migration | `[ ! -f "docs/guide/zh/$base" ] && echo "missing ZH: $base"` |
| 120 | display | — | `Flag any docs/guide/en/<topic>.md that has no matching docs/guide/zh/<topic>.md` |
| 132 | read | — | `Dependency gate: skip when docs/features.md does not exist.` |
| 134 | read | — | `Parse BACKLOG.md ... Parse docs/features.md for Feature names ... absent from docs/features.md` |
| 171 | comment | — | `# For each file listed in docs/features/*.md or README.md "## Files:" sections:` |
| 178 | display | — | `The "owner doc" for a source file is the nearest README.md or docs/features/*.md` |
| 207 | comment | — | `# check if any docs/domain/*.md contains the directory name` |
| 213 | display | — | `Flag directories with ≥3 source files and zero name-match in docs/domain/*.md.` |
| 223 | display | — | `... 架构文档缺失模块：{N} 个（≥3 个源文件的目录未出现在 docs/domain/）` |
| 229 | display | — | `### REFACTOR Entry (BACKLOG.md)` |
| 232 | write | needs-file-migration | `section of BACKLOG.md:` |
| 243 | write | needs-file-migration | `### Dream Log (docs/dream/YYYY-MM-DD.md)` |
| 286 | write | needs-file-migration | `git add BACKLOG.md docs/dream/YYYY-MM-DD.md` (executable git command) |
| 294 | display | — | `BACKLOG.md 和 dream 日志必须在同一个 commit 里入库 ...` |
| 296 | display | — | `仅 BACKLOG.md 和 docs/dream/YYYY-MM-DD.md 入 commit` |
| 311 | write | needs-file-migration | `Write partial results to docs/dream/YYYY-MM-DD.md ...` |

### skills/roll-doc/SKILL.md (23 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 5 | display | — | description: `builds/updates docs/INDEX.md, identifies undocumented modules` |
| 17 | display | — | `docs/INDEX.md is out of date or doesn't exist yet` |
| 42 | display | — | `node_modules/   .git/   dist/   build/   .shared/   docs/dream/   docs/briefs/` (excludes list) |
| 56 | display | — | `\| guide \| Path under docs/guide/ \|` |
| 57 | display | — | `\| domain \| Path under docs/domain/ \|` |
| 62 | write | code-only | `Output — produce/update docs/INDEX.md:` |
| 73 | display | — | `\| docs/guide/en/loop.md \| Loop User Guide \| guide \| 2026-05-01 \|` |
| 90 | write | code-only | `docs/INDEX.md is always overwritten on each run` |
| 97 | read | code-only | `If count ≥ 3 AND no README.md in that directory AND no docs/INDEX.md entry links to it` |
| 100 | display | — | `No docs/domain/ directory or empty → gap: docs/domain/context-map.md` |
| 125 | display | — | `\| No docs/domain/ entries \| docs/domain/context-map.md \|` |
| 133 | read | — | `Scan which doc directories actually exist: docs/domain/, docs/features/, docs/practices/, etc.` |
| 135 | read | — | `If docs/domain/context-map.md exists, read it` |
| 145 | display | — | `Domain model: docs/domain/context-map.md` |
| 146 | display | — | `Story details: docs/features/` |
| 173 | display | — | `N docs scanned, docs/INDEX.md updated` |
| 192 | display | — | `roll-doc: no gaps found. docs/INDEX.md updated.` |
| 204 | write | code-only | `docs/INDEX.md is the only existing file that may be overwritten` |

### skills/roll-build/SKILL.md (18 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 57 | read | — | `Open BACKLOG.md, find the US row, follow the link to docs/features/<feature>.md` |
| 163 | write | — | `Insert US into BACKLOG.md under the relevant Epic > Feature group` |
| 164 | write | — | `If a new docs/features/<feature>.md is needed, create it` |
| 278 | comment | — | `# 1. Append to BACKLOG.md under ## ♻️ Refactor` |
| 281 | comment | — | `# 2. Append a brief entry to docs/features/refactor-log.md` |
| 284 | display | — | `REFACTOR entry format in BACKLOG.md:` |
| 290 | display | — | `... 技术细节写在 docs/features/refactor-log.md` |
| 507 | write | — | `① Update BACKLOG.md index row (Status column):` |
| 510 | display | — | `\| [US-{ID}](docs/features/<feature>.md#us-{id}) \| {Title} \| ✅ Done \|` |
| 516 | write | — | `② Update docs/features/<feature>.md US section:` |
| 547 | write | needs-file-migration | `git add BACKLOG.md docs/features/ CHANGELOG.md` (executable) |
| 617 | display | — | `BACKLOG.md index row and docs/features/<feature>.md US section are both required` |
| 636 | display | — | `BACKLOG.md index status updated (📋 → ✅, REQUIRED)` |
| 637 | display | — | `docs/features/<feature>.md US section updated` |
| 688 | display | — | `roll-idea → fast capture a bug or idea into BACKLOG.md` |

### skills/roll-propose/SKILL.md (14 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 8 | display | — | `Writes to PROPOSALS.md for human review` |
| 21 | display | — | `PROPOSALS.md for human approval before entering BACKLOG.` |
| 29 | display | — | `\| Output \| PROPOSALS.md (pending approval) \| BACKLOG (REFACTOR-XXX) \|` |
| 52 | read | — | `BACKLOG.md — all existing US-XXX, FIX-XXX, REFACTOR-XXX, IDEA-XXX entries` |
| 53 | read | — | `PROPOSALS.md (if exists) — already-proposed items` |
| 100 | write | — | `Step 4 — Write to PROPOSALS.md` |
| 102 | write | — | `Append to PROPOSALS.md in the project root (create if absent)` |
| 118 | display | — | `roll-propose: {N} proposal(s) written to PROPOSALS.md` |
| 120 | display | — | `To approve: move the entry to BACKLOG.md and assign a US-XXX ID.` |
| 127 | display | — | `Never write directly to BACKLOG.md — PROPOSALS.md is the staging area.` |
| 128 | display | — | `If a similar proposal already exists in PROPOSALS.md ...` |
| 131 | display | — | `## PROPOSALS.md Format` |
| 136 | display | — | `> 待审批提案。批准后手工移入 BACKLOG.md 并分配 US-XXX 编号。` |

### skills/roll-brief/SKILL.md (14 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 65 | read | needs-file-migration | `ls docs/briefs/ \| sort \| tail -1` (executable bash) |
| 67 | read | — | `# Read BACKLOG.md — collect all status changes since last brief` |
| 74 | read | — | `From BACKLOG.md and git log, classify all items since last brief:` |
| 81 | read | — | `Doc coverage: compute from docs/guide/en/ and docs/guide/zh/:` |
| 82 | read | needs-file-migration | `EN coverage = number of files in docs/guide/en/` |
| 83 | read | needs-file-migration | `ZH translation rate = files in docs/guide/zh/ ÷ files in docs/guide/en/ × 100%` |
| 101 | write | needs-file-migration | `文件命名：docs/briefs/YYYY-MM-DD-{NN}.md` |
| 102 | read | needs-file-migration | `ls docs/briefs/YYYY-MM-DD-*.md 2>/dev/null \| wc -l` |
| 132 | read | — | `{来自 docs/dream/ 的摘要}` |
| 168 | write | needs-file-migration | `git add docs/briefs/YYYY-MM-DD-NN.md` |
| 175 | display | — | `仅 docs/briefs/ 下新文件入 commit` |
| 182 | display | — | `📋 简报已生成：docs/briefs/2026-05-10-01.md` |

### skills/roll-.changelog/SKILL.md (13 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 6 | display | — | description: `extracts completed Stories from BACKLOG.md to generate CHANGELOG.md` |
| 11 | display | — | `extracts completed Stories from BACKLOG.md to generate ... CHANGELOG.md` |
| 34 | read | — | `### 2. Read BACKLOG.md` |
| 42 | read | — | `Read each Story's docs/features/<feature>.md for Completed date.` |
| 364 | write | — | `请求"整体重写 docs/features.md"` |
| 370 | display | — | `## 当前任务：重写 docs/features.md（Section 8）` 开头的 prompt` |
| 375 | display | — | `当前 docs/features.md（可能为空，可能上一版本的）` |
| 376 | read | — | `当前 BACKLOG.md 全文（Epic / Feature 分组结构）` |
| 377 | read | — | `当前 docs/features/ 目录清单` |
| 382 | write | — | `把整个 docs/features.md 写出来` |
| 402 | display | — | `- [<Feature 名>](docs/features/<file>.md) — 1 句话描述` |
| 417 | display | — | `Feature 名跟 docs/features/<file>.md 文件名一致时，加链接到该 md` |
| 427 | display | — | `... 与 docs/guide/en\|zh/ 平行目录约定不一致` |

### skills/roll-loop/SKILL.md (11 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 7 | display | — | description: `scans BACKLOG.md for 📋 Todo items` |
| 58 | display | — | `Files inside it (BACKLOG.md, bin/roll, tests/, docs/) are always` |
| 91 | read | — | `Scan BACKLOG.md for all rows whose Status column contains 🔨 In Progress.` |
| 140 | read | — | `Read BACKLOG.md. Collect all rows where Status = 📋 Todo` |
| 168 | read | needs-file-migration | `bash -c '... _loop_is_manual_only "<story-id>" BACKLOG.md'` (executable) |
| 172 | read | needs-file-migration | `bash -c '... _loop_check_depends_on "<story-id>" BACKLOG.md'` |
| 179 | display | — | `over BACKLOG.md text — no side effects` |
| 204 | write | — | `mark the story 🔨 In Progress in BACKLOG.md` |
| 206 | write | — | `Edit BACKLOG.md: change the row's Status column from 📋 Todo to 🔨 In Progress.` |
| 247 | write | — | `revert story status in BACKLOG.md from ✅ Done → 📋 Todo` |
| 501 | read | — | `├── reads      BACKLOG.md` (ASCII diagram) |

### skills/roll-fix/SKILL.md (8 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 4 | display | — | description: `Reads FIX/BUG from BACKLOG.md` |
| 22 | read | — | `Read BACKLOG.md index → Find FIX/BUG row → Follow link to docs/features/<feature>.md` |
| 25 | write | — | `Write back: update BACKLOG.md status column + update FIX section in Feature file` |
| 293 | write | — | `① Update BACKLOG.md index row (Status column):` |
| 296 | display | — | `\| [FIX-{ID}](docs/features/<feature>.md#fix-{id}) \| ...` |
| 301 | write | — | `② Update docs/features/<feature>.md FIX section:` |
| 337 | display | — | `BACKLOG.md updated ✅` |

### skills/roll-idea/SKILL.md (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 5 | display | — | description: `appends it to BACKLOG.md with an auto-incremented ID` |
| 30 | read | — | `Read BACKLOG.md from the project root.` |
| 37 | write | — | `Append a new row to the appropriate table in BACKLOG.md:` |
| 58 | read | — | `If BACKLOG.md does not exist, report an error and stop.` |

### skills/roll-sentinel/SKILL.md (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 321 | display | — | `│     └── Add FIX-AUDIO-015 to BACKLOG.md                     │` |

### skills/roll-peer/SKILL.md (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 247 | display | — | `Decision record: If AGREE, append summary to docs/decisions/ or BACKLOG.md (optional)` |

Note: `docs/decisions/` is mentioned but does not exist in repo — code-only reference.

### skills/roll-debug/SKILL.md (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 590 | display | — | `│   └── ESCALATE: create US-XXX in BACKLOG.md` |

### Skills with no hits (9 files)

`roll-.clarify`, `roll-.echo`, `roll-.qa`, `roll-.review`, `roll-doctor`, `roll-notes`, `roll-research`, `roll-review-pr`, `roll-spar` — verified zero matches.

## Area 3: tests/

186 hits across 35 of 113 test files. Tests typically `mkdir -p docs/...` + `cat > BACKLOG.md`, then assert behavior — most lines tag as `both` (write in setup + read in assertion).

### tests/integration/cmd_init.bats (17 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 4 | comment | — | `#   1. Fresh project  → creates AGENTS.md + BACKLOG.md + docs/features/` |
| 33 | display | — | `@test "init: creates BACKLOG.md in new project" {` |
| 36 | read | needs-file-migration | `[ -f "${PROJECT_DIR}/BACKLOG.md" ]` |
| 39 | display | — | `@test "init: creates docs/features/ in new project" {` |
| 42 | read | needs-file-migration | `[ -d "${PROJECT_DIR}/docs/features" ]` |
| 58 | display | — | `@test "init: backfills BACKLOG.md when AGENTS.md exists but backlog is missing" {` |
| 61 | write | needs-file-migration | `rm -f "${PROJECT_DIR}/BACKLOG.md"` |
| 66 | read | needs-file-migration | `[ -f "${PROJECT_DIR}/BACKLOG.md" ]` |
| 69 | display | — | `@test "init: backfills docs/features when AGENTS.md exists but features dir is missing" {` |
| 77 | read | needs-file-migration | `[ -d "${PROJECT_DIR}/docs/features" ]` |
| 88 | display | — | `@test "init: summary box includes BACKLOG.md on fresh project" {` |
| 91 | comment | — | `# The summary box line looks like: "│  + created     BACKLOG.md"` |
| 92 | read | needs-file-migration | `[[ "$output" == *"created"*"BACKLOG.md"* ]]` (asserts output text) |
| 95 | display | — | `@test "init: summary box includes docs/features on fresh project" {` |
| 98 | comment | — | `# The summary box line looks like: "│  + created     docs/features/"` |
| 99 | read | needs-file-migration | `[[ "$output" == *"created"*"docs/features"* ]]` |

### tests/integration/cmd_backlog.bats (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 18 | write | code-only | `mkdir -p "${TEST_TMP}/docs/features"` (test fixture) |
| 19 | write | code-only | `cat > "${TEST_TMP}/BACKLOG.md" << 'EOF'` |
| 33 | display | — | `\| [US-CORE-001](docs/features/core.md) \| ...` (fixture content) |
| 34 | display | — | `\| [US-CORE-002](docs/features/core.md) \| Another core feature \| ✅ Done \|` |

### tests/integration/cmd_brief.bats (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 18 | write | code-only | `mkdir -p "${TEST_TMP}/docs/briefs"` |
| 19 | write | code-only | `cat > "${TEST_TMP}/docs/briefs/2026-05-17-01.md" << 'EOF'` |

### tests/integration/cmd_dashboard.bats (6 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 16 | write | code-only | `cat > BACKLOG.md <<'EOF'` |
| 20 | display | — | `\| [US-DEMO-001](docs/features/demo.md#us-demo-001) \| ...` |
| 21 | display | — | `\| [US-DEMO-002](docs/features/demo.md#us-demo-002) \| demo wip \| 🔨 In Progress \|` |
| 63 | display | — | `@test "roll (no args): degrades gracefully when no BACKLOG.md" {` |
| 64 | write | code-only | `rm BACKLOG.md` |
| 67 | comment | — | `# Without BACKLOG.md main() falls through to _help + changelog.` |

### tests/integration/dream_features_freshness.bats (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 4 | comment | — | `# matching BACKLOG Feature groups against docs/features.md and emitting REFACTOR entries.` |

### tests/integration/release_features_sync.bats (9 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 12 | variable | needs-file-migration | `FEATURES_MD="${BATS_TEST_DIRNAME}/../../docs/features.md"` |
| 30 | display | — | `@test "release.sh stages docs/features.md in the release commit" {` |
| 34 | read | needs-file-migration | `grep -qE 'git add .* docs/features\.md' "$RELEASE_SH"` |
| 39 | read | needs-file-migration | `grep -qF "cmp -s docs/features.md" "$RELEASE_SH"` |
| 56 | display | — | `@test "bootstrap docs/features.md has the three required sections" {` |
| 84 | display | — | `@test "bootstrap docs/features.md covers each BACKLOG ### Feature group" {` |
| 86 | comment | — | `# (link or plain mention by name). Allow either docs/features/<name>.md link` |
| 91 | read | needs-file-migration | `if ! grep -qE "docs/features/${feat}\.md\|${feat}" "$FEATURES_MD"; then` |
| 95 | read | needs-file-migration | `done < <(grep -oE '^### Feature: [a-z0-9-]+' "${BATS_TEST_DIRNAME}/../../BACKLOG.md" \| ...)` |

### tests/unit/roll_backlog.bats (22 hits)

All 22 hits are either `cat > "$TEST_DIR/BACKLOG.md"` fixtures or `echo ... >> "$TEST_DIR/BACKLOG.md"` mutations, plus one `docs/features/...` link inside fixture markdown content. Lines: 20, 32, 50, 59, 68, 69, 80, 91, 102, 103, 104, 105, 118, 126, 136, 145, 155, 165 — all `write` direction, `code-only` (fixture files inside test temp dir, not real project paths). Tag: all need updating in lockstep with bin/roll's BACKLOG.md → .roll/backlog.md change.

### tests/unit/roll_dashboard.bats (21 hits)

Mix of fixtures: `cat > BACKLOG.md`, `mkdir -p docs/briefs`, `cat > docs/briefs/2026-05-12-99.md`, `cat > PROPOSALS.md`, plus links in fixture markdown. Lines: 24, 28, 76, 79, 88, 110, 111, 138, 139, 140, 141, 153, 154, 170, 171, 181, 182, 195, 196, 223, 224. All `code-only` test fixtures; need updating to match new paths.

### tests/unit/release_planning_marker.bats (18 hits)

Test fixtures for `_enforce_planning_markers`: BACKLOG.md + features.md + docs/features/<x>.md mock content. Lines 19, 29, 30, 32, 33, 34, 38, 45, 50, 55, 57, 64, 69, 72, 77, 82, 84, 91. All `write` direction creating fixtures, then `read` via grep assertions. All `code-only`.

### tests/unit/loop_tcr.bats (11 hits)

Lines 62, 70, 74, 82, 86, 96, 100, 104, 109, 113, 121 — `printf ... > BACKLOG.md` fixtures + `grep -q "..." BACKLOG.md` assertions. All `code-only`.

### tests/unit/roll_loop_depends_on.bats (9 hits)

Lines 17 (variable: `_backlog="${TEST_TMP}/fixture-backlog.md"` — not the audit pattern, but a renamed fixture), 25-30 (fixture content with `docs/features/foo.md` links), 84 (test name), 85-86 (`cp "$_backlog" "${TEST_TMP}/BACKLOG.md"`).

### tests/unit/release_ai_calls.bats (6 hits)

Lines 42-45 (assertions that release.sh doesn't inline BACKLOG.md), 69-70, 74. Tests that release.sh references docs/features.md in `git add`. All `read` direction (grep on release.sh).

### tests/unit/roll_doc_domain.bats (5 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 2 | comment | — | `# Tests for US-DOC-003: docs/domain/ DDD context map` |
| 4 | variable | needs-file-migration | `DOMAIN_DIR="${BATS_TEST_DIRNAME}/../../docs/domain"` |
| 10 | display | — | `@test "docs/domain/ directory exists" {` |
| 14 | display | — | `@test "docs/domain/context-map.md exists" {` |
| 18 | display | — | `@test "docs/domain/autonomous-operation.md exists" {` |

### tests/unit/roll_doc_agents_conventions.bats (5 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 7 | read | — | `grep -qF 'docs/guide/en/' "${ROOT}/AGENTS.md"` |
| 8 | read | — | `grep -qF 'docs/guide/zh/' "${ROOT}/AGENTS.md"` |
| 9 | read | — | `grep -qF 'docs/domain/' "${ROOT}/AGENTS.md"` |
| 10 | read | — | `grep -qF 'docs/features/' "${ROOT}/AGENTS.md"` |
| 11 | read | — | `grep -qF 'docs/practices/' "${ROOT}/AGENTS.md"` |

Asserts AGENTS.md content — must update assertions if AGENTS.md keeps the new `.roll/`, `guide/` paths.

### tests/unit/roll_doc_structure.bats (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 13 | display | — | `@test "e2e: docs/guide/en/ has methodology, skills, plus original 4 guides" {` |
| 22 | display | — | `@test "e2e: docs/guide/zh/ has methodology, skills, plus original 4 guides" {` |
| 31 | display | — | `@test "e2e: docs/practices/ has loop-autorun-verification.md" {` |
| 48 | variable | needs-file-migration | `local backlog="${BATS_TEST_DIRNAME}/../../BACKLOG.md"` |

### tests/unit/roll_doc_skill.bats (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 24 | display | — | `@test "roll-doc SKILL.md: specifies docs/INDEX.md as output" {` |
| 25 | read | code-only | `grep -qF 'docs/INDEX.md' "$SKILL"` |
| 44 | read | — | `grep -qF 'docs/dream' "$SKILL"` |
| 45 | read | — | `grep -qF 'docs/briefs' "$SKILL"` |

### tests/unit/roll_doc_readme.bats (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 21 | display | — | `@test "README.md links to docs/guide/en/ files" {` |
| 22 | read | — | `grep -qF 'docs/guide/en/' "${ROOT}/README.md"` |
| 36 | display | — | `@test "README_CN.md links to docs/guide/zh/ files" {` |
| 37 | read | — | `grep -qF 'docs/guide/zh/' "${ROOT}/README_CN.md"` |

### tests/unit/roll_doc_guide_en.bats (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 2 | comment | — | `# Tests for US-DOC-001: docs/guide/en/ English user guides` |
| 4 | variable | needs-file-migration | `GUIDE_DIR="${BATS_TEST_DIRNAME}/../../docs/guide/en"` |
| 55 | display | — | `@test "e2e: dream.md mentions docs/dream/ output directory" {` |
| 56 | read | needs-file-migration | `grep -qF 'docs/dream/' "${GUIDE_DIR}/dream.md"` |

### tests/unit/roll_doc_configuration.bats (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 5 | variable | needs-file-migration | `EN="${BATS_TEST_DIRNAME}/../../docs/guide/en/configuration.md"` |
| 6 | variable | needs-file-migration | `ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh/configuration.md"` |
| 35 | read | — | `grep -qF 'configuration.md' "${BATS_TEST_DIRNAME}/../../docs/guide/en/overview.md"` |
| 39 | read | — | `grep -qF 'configuration.md' "${BATS_TEST_DIRNAME}/../../docs/guide/zh/overview.md"` |

### tests/unit/docs_guide_coverage.bats (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 3 | comment | — | `# in both docs/guide/en/ and docs/guide/zh/. (REFACTOR-019)` |
| 10 | variable | needs-file-migration | `GUIDE_EN="${BATS_TEST_DIRNAME}/../../docs/guide/en"` |
| 11 | variable | needs-file-migration | `GUIDE_ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh"` |
| 15+ | read | needs-file-migration | Multiple `[ -f "${GUIDE_EN}/<file>.md" ]` and `[ -f "${GUIDE_ZH}/<file>.md" ]` checks |

### tests/unit/roll_status.bats (3 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 93 | display | — | `@test "status loop overview: shows todo count from BACKLOG.md" {` |
| 97 | write | code-only | `cat > "${TEST_DIR}/myproject/BACKLOG.md" << 'BACKLOG'` |
| 106 | display | — | `@test "status loop overview: shows 0 pending when no BACKLOG.md" {` |

### tests/unit/roll_loop_pr.bats (3 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 188 | display | — | `@test "_loop_is_doc_only_change: returns 0 when only BACKLOG.md changed" {` |
| 191 | write | code-only | `echo "new" > BACKLOG.md` (test fixture) |
| 192 | write | code-only | `git -c user.email=t@t -c user.name=t add BACKLOG.md` |

### tests/unit/roll_changelog_lint.bats (3 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 28 | display | — | `run _changelog_lint_bullet "- **Added**: BACKLOG.md 加新栏"` (test input string) |
| 99 | display | — | `run _changelog_lint_bullet "- **Added**: docs/features 新增 plan"` |
| 131 | display | — | `'- **Added**: docs/features 新增 plan 文件'` |

### tests/unit/docs_configuration_env_vars.bats (3 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 3 | comment | — | `# are documented in docs/guide/{en,zh}/configuration.md (REFACTOR-029).` |
| 10 | variable | needs-file-migration | `DOCS_EN="${BATS_TEST_DIRNAME}/../../docs/guide/en/configuration.md"` |
| 11 | variable | needs-file-migration | `DOCS_ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh/configuration.md"` |

### tests/unit/roll_loop_ci_gate.bats (2 hits)

Lines 62, 67: `printf '...' > BACKLOG.md` fixture + `grep -q "🔨 In Progress" BACKLOG.md` assertion. `code-only`.

### tests/unit/roll_dream_skill.bats (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 55 | read | — | `grep -qF 'git add BACKLOG.md docs/dream/YYYY-MM-DD.md' "$SKILL_FILE"` (asserts SKILL.md content) |

### tests/unit/roll_doc_guide_zh.bats (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 2 | comment | — | `# Tests for US-DOC-002: docs/guide/zh/ Chinese user guides` |
| 4 | variable | needs-file-migration | `GUIDE_DIR="${BATS_TEST_DIRNAME}/../../docs/guide/zh"` |

### tests/unit/roll_doc_faq.bats (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 3 | variable | needs-file-migration | `GUIDE_EN="${BATS_TEST_DIRNAME}/../../docs/guide/en"` |
| 4 | variable | needs-file-migration | `GUIDE_ZH="${BATS_TEST_DIRNAME}/../../docs/guide/zh"` |

### tests/unit/roll_brief.bats (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 10 | write | code-only | `mkdir -p "${TEST_DIR}/docs/briefs"` |
| 18 | write | code-only | `cat > "${TEST_DIR}/docs/briefs/2026-05-17-01.md" << 'EOF'` |

### tests/unit/agents_md_where_to_look.bats (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 11 | display | — | `@test "conventions/global/AGENTS.md: Where to Look points to docs/domain/" {` |
| 12 | read | — | `grep -qF 'docs/domain/' "${ROOT}/conventions/global/AGENTS.md"` |

### tests/unit/roll_web_terminal.bats (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 4 | variable | needs-file-migration | `SITE="${BATS_TEST_DIRNAME}/../../docs/site"` |

### tests/unit/roll_dream_scan6.bats (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 21 | read | — | `grep -qiE 'existence drift\|docs/domain' "$SKILL"` |

### tests/unit/roll_brief_skill.bats (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 12 | read | — | `grep -qF 'git add docs/briefs/YYYY-MM-DD-' "$SKILL_FILE"` |

### tests/unit/loop_pr_claimed_stories.bats (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 54 | display | — | `\| [US-AUTO-033](docs/features/foo.md#us-auto-033) \| a linked story \| 🔨 In Progress \|` (fixture) |

### tests/unit/roll_loop_monitor.bats (5 hits)

Lines 161 (`cat > "$TEST_DIR/BACKLOG.md"`), 176-177 (`grep ... BACKLOG.md`), 182-183 (`grep -n ... BACKLOG.md`). `code-only`.

## Area 4: conventions/

22 hits across 5 of 5 AGENTS.md files (global + 4 templates). All are `display` direction — documentation prose pointing users at the project workspace structure.

### conventions/global/AGENTS.md (6 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 47 | display | — | `**Workspace**: BACKLOG.md index. docs/features/ for details.` |
| 52 | display | — | `Technical details and AC go in docs/features/.` |
| 104 | display | — | `**Domain model**: docs/domain/context-map.md — Bounded Contexts and relationships` |
| 105 | display | — | `**Story details**: docs/features/ — AC, implementation specs, dependencies` |
| 106 | display | — | `**Design decisions**: docs/domain/ — DDD models, architecture records` |
| 107 | display | — | `When docs/domain/ or docs/features/ don't exist yet, run $roll-doc to bootstrap.` |

### conventions/templates/{fullstack,cli,frontend-only,backend-service}/AGENTS.md

Each contains 4 hits identical in pattern (lines differ slightly):

| Template | Lines | Pattern |
|----------|-------|---------|
| fullstack | 34, 37, 38, 39 | Workspace + Domain model + Story details + Design decisions |
| cli | 34, 37, 38, 39 | Same pattern |
| frontend-only | 31, 34, 35, 36 | Same pattern |
| backend-service | 32, 35, 36, 37 | Same pattern |

All 16 lines are `display` direction, refer to `BACKLOG.md`, `docs/features/`, `docs/domain/`. Variable refs: none (pure prose).

## Area 5: lib/

18 hits across 6 of 8 Python files. Variable assignments are common in Python.

### lib/roll-help.py (1 hit)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 48 | display | — | `("init", "", "create AGENTS.md + BACKLOG.md + docs/", "初始化项目工作流文件", False),` |

### lib/roll-status.py (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 296 | display | — | `_file_row("BACKLOG.md", d["project_has_backlog"])` |
| 297 | display | — | `_file_row("docs/features/", d["project_features_count"] > 0,` |
| 332 | variable | needs-file-migration | `feat_dir = Path("docs/features")` |
| 339 | read | needs-file-migration | `project_has_backlog = Path("BACKLOG.md").exists(),` (passed inside dataclass init from `Path("BACKLOG.md").exists()`) |
| 340 | read | needs-file-migration | `project_features_count = sum(1 for _ in feat_dir.glob("*.md")) if feat_dir.exists() else 0,` |

Variable: `feat_dir` (line 332).

### lib/roll-brief.py (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 5 | comment | — | `Parses the latest docs/briefs/<date>.md and renders it as three sections:` (docstring) |
| 272 | variable | needs-file-migration | `briefs_dir = "docs/briefs"` |
| 274 | read | needs-file-migration | `briefs = sorted(f for f in os.listdir(briefs_dir) if f.endswith(".md"))` |
| 275 | read | needs-file-migration | `... if os.path.isdir(briefs_dir) else []` |
| 281 | read | needs-file-migration | `latest = os.path.join(briefs_dir, briefs[-1])` |

Variable: `briefs_dir` (272).

### lib/roll-home.py (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 148 | variable | needs-file-migration | `bl = Path("BACKLOG.md")` |
| 170 | read | code-only | `m2 = re.search(r"docs/features/[^\)]+", line)` (regex — see Special Cases) |
| 182 | variable | needs-file-migration | `p = Path("PROPOSALS.md")` |
| 188 | variable | needs-file-migration | `briefs_dir = Path("docs/briefs")` |
| 189 | read | needs-file-migration | `if not briefs_dir.exists():` |
| 205 | read | needs-file-migration | `briefs = sorted(briefs_dir.glob("*.md"))` |
| 420 | display | — | `c("dim", "      see: ") + c("blue", "PROPOSALS.md"))` |

Variables: `bl` (148), `p` (182), `briefs_dir` (188).

### lib/roll-loop-status.py (3 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 9 | comment | — | `./BACKLOG.md                                   story id → description` (docstring) |
| 140 | comment | — | `"""Map story id → description from BACKLOG.md table rows."""` |
| 141 | variable | needs-file-migration | `path = (project_root or Path()) / "BACKLOG.md"` |

Variable: `path` (141, ephemeral).

### lib/roll-backlog.py (4 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 5 | comment | — | `Parses BACKLOG.md and renders items grouped by type:` |
| 218 | variable | needs-file-migration | `backlog = "BACKLOG.md"` |
| 247 | display | — | `\| [US-AUTO-042](docs/features/autonomous-evolution.md) \| ...` (demo data string) |

Variable: `backlog` (218).

### lib/loop-fmt.py, lib/model_prices.py, lib/roll_render.py, lib/roll-setup.py

Zero hits — verified.

## Area 6: hooks/

Zero hits across `hooks/pre-commit` and `hooks/prepare-commit-msg`. Verified.

## Area 7: scripts/

21 hits in scripts/release.sh, the only file.

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 38 | variable | needs-file-migration | `local features="${1:-docs/features.md}"` |
| 39 | variable | needs-file-migration | `local backlog="${2:-BACKLOG.md}"` |
| 63 | read | needs-file-migration | awk regex: `if (index($0, "(docs/features/" name ".md)") > 0 \|\| ...)` |
| 90 | read | needs-file-migration | `' BACKLOG.md` (closing arg of awk on line 89) |
| 119 | display | — | `当前 BACKLOG.md ✅ Done 条目（最近 40 条）：` (prompt text) |
| 120 | read | needs-file-migration | `$(grep '✅ Done' BACKLOG.md \| tail -40)` |
| 130 | comment | — | `# ── AI call 2: rewrite docs/features.md (section 8 only + compact BACKLOG) ──` |
| 140 | read | needs-file-migration | `[[ -f docs/features.md ]] && current_features=$(<docs/features.md)` |
| 142 | read | needs-file-migration | `features_dir_listing=$(printf '%s\n' docs/features/*.md \` |
| 143 | read | needs-file-migration | `\| sed 's\|^docs/features/\|\|' \` |
| 150 | display | — | `## 当前任务：重写 docs/features.md（Section 8）` |
| 152 | display | — | `按 Section 8 规则把整个 docs/features.md 写出来。` |
| 156 | display | — | `### 当前 docs/features.md：` |
| 159 | display | — | `### 当前 docs/features/ 目录（仅文件名）：` |
| 208 | comment | — | `# ── AI call 2: rewrite docs/features.md ──────────────────────────────────────` |
| 210 | display | — | `echo "Rewriting docs/features.md via ${_release_agent}..." >&2` |
| 217 | read | needs-file-migration | `if ! cmp -s docs/features.md "$_tmp_features" 2>/dev/null; then` |
| 218 | write | needs-file-migration | `mv "$_tmp_features" docs/features.md` |
| 219 | display | — | `echo "docs/features.md updated." >&2` |
| 237 | both | needs-file-migration | `_enforce_planning_markers docs/features.md BACKLOG.md` (call site, passes both as args) |
| 240 | write | needs-file-migration | `git add package.json bin/roll release_notes.txt CHANGELOG.md docs/features.md` |

Variables: `features` (38), `backlog` (39), `features_dir_listing` (142).

## Area 8: template/ and templates/

### template/AGENTS.md (2 hits)

| Line | Direction | Migration | Content |
|------|-----------|-----------|---------|
| 15 | display | — | `**Design**: $roll-design -> Stories -> BACKLOG.md` |
| 18 | display | — | `**Workspace**: BACKLOG.md index. docs/features/<feat>.md for details.` |

Variables: none.

### templates/workflows/pr-review-event.yml

Zero hits — verified.

## Variable Path Catalog

Cross-reference of every variable holding an old path. Variable type column: `bash-local`, `bash-global`, `python-local`, `python-module`.

| File | Line | Variable | Value | Type | Used in |
|------|------|----------|-------|------|---------|
| bin/roll | 3365 | `_LOOP_RUNS_BACKLOG` | (content, not path; set from `cat BACKLOG.md` at 3366) | bash-global | 3294, 3295, 3366, 3372 |
| bin/roll | 3728 | `backlog` | `"${2:-BACKLOG.md}"` | bash-local | 3729, 3735, 3751 (`_loop_check_depends_on`) |
| bin/roll | 3765 | `backlog` | `"${2:-BACKLOG.md}"` | bash-local | 3766, 3770 (`_loop_is_manual_only`) |
| bin/roll | 4640 | `backlog` | `"BACKLOG.md"` | bash-local | 4641, 4644, 4645, 4646, 4680 |
| bin/roll | 4750 | `briefs_dir` | `"docs/briefs"` | bash-local | 4751, 4756, 4764 |
| bin/roll | 4819 | `backlog` | `"BACKLOG.md"` | bash-local | 4820+ (passed to inline python3) |
| bin/roll | 4950 | `backlog` | `"BACKLOG.md"` | bash-local | 4951, 4952 |
| skills/roll-design/SKILL.md | 626 | `PLAN_FILE` | `"docs/features/${FEATURE}-plan.md"` | bash-doc | 627 (in skill code block) |
| skills/roll-design/SKILL.md | 629 | `FEATURE_FILE` | `"docs/features/${FEATURE}.md"` | bash-doc | 630 (in skill code block) |
| skills/roll-design/SKILL.md | 635 | `DOMAIN_DIR` | `"docs/domain/"` | bash-doc | 636-638 (in skill code block) |
| tests/integration/release_features_sync.bats | 12 | `FEATURES_MD` | `"${BATS_TEST_DIRNAME}/../../docs/features.md"` | bash-local | 57, 58, 59, 91 |
| tests/unit/roll_doc_domain.bats | 4 | `DOMAIN_DIR` | `"${BATS_TEST_DIRNAME}/../../docs/domain"` | bash-local | 5, 6, 11 |
| tests/unit/roll_doc_guide_en.bats | 4 | `GUIDE_DIR` | `"${BATS_TEST_DIRNAME}/../../docs/guide/en"` | bash-local | 7-56 (multiple) |
| tests/unit/roll_doc_guide_zh.bats | 4 | `GUIDE_DIR` | `"${BATS_TEST_DIRNAME}/../../docs/guide/zh"` | bash-local | 7-56 (multiple) |
| tests/unit/roll_doc_faq.bats | 3 | `GUIDE_EN` | `"${BATS_TEST_DIRNAME}/../../docs/guide/en"` | bash-local | 7, 15+ |
| tests/unit/roll_doc_faq.bats | 4 | `GUIDE_ZH` | `"${BATS_TEST_DIRNAME}/../../docs/guide/zh"` | bash-local | 11, 63 |
| tests/unit/docs_guide_coverage.bats | 10 | `GUIDE_EN` | `"${BATS_TEST_DIRNAME}/../../docs/guide/en"` | bash-local | 15, 23, 31, 39, 47, 55, 63, 71 |
| tests/unit/docs_guide_coverage.bats | 11 | `GUIDE_ZH` | `"${BATS_TEST_DIRNAME}/../../docs/guide/zh"` | bash-local | 18, 26, 34, 42, 50, 58, 66, 74 |
| tests/unit/roll_doc_configuration.bats | 5 | `EN` | `"${BATS_TEST_DIRNAME}/../../docs/guide/en/configuration.md"` | bash-local | 14, 17, 20, 23, 26 |
| tests/unit/roll_doc_configuration.bats | 6 | `ZH` | `"${BATS_TEST_DIRNAME}/../../docs/guide/zh/configuration.md"` | bash-local | 30, 33, 36, 39, 42 |
| tests/unit/docs_configuration_env_vars.bats | 10 | `DOCS_EN` | `"${BATS_TEST_DIRNAME}/../../docs/guide/en/configuration.md"` | bash-local | 14, 17, 20, 23, 26 |
| tests/unit/docs_configuration_env_vars.bats | 11 | `DOCS_ZH` | `"${BATS_TEST_DIRNAME}/../../docs/guide/zh/configuration.md"` | bash-local | 30, 33, 36, 39, 42 |
| tests/unit/roll_doc_structure.bats | 48 | `backlog` | `"${BATS_TEST_DIRNAME}/../../BACKLOG.md"` | bash-local | one-shot use |
| tests/unit/roll_web_terminal.bats | 4 | `SITE` | `"${BATS_TEST_DIRNAME}/../../docs/site"` | bash-local | (other tests in file) |
| tests/unit/roll_loop_depends_on.bats | 17 | `_backlog` | `"${TEST_TMP}/fixture-backlog.md"` | bash-local | filename not a project path, but its `cp ... BACKLOG.md` step at line 86 requires updating the BACKLOG target name |
| lib/roll-status.py | 332 | `feat_dir` | `Path("docs/features")` | python-local | 340 |
| lib/roll-brief.py | 272 | `briefs_dir` | `"docs/briefs"` | python-local | 274, 275, 281 |
| lib/roll-home.py | 148 | `bl` | `Path("BACKLOG.md")` | python-local | rest of fn (parses BACKLOG content) |
| lib/roll-home.py | 182 | `p` | `Path("PROPOSALS.md")` | python-local | proposal-count fn |
| lib/roll-home.py | 188 | `briefs_dir` | `Path("docs/briefs")` | python-local | 189, 205 |
| lib/roll-loop-status.py | 141 | `path` | `(project_root or Path()) / "BACKLOG.md"` | python-local | rest of `load_backlog()` |
| lib/roll-backlog.py | 218 | `backlog` | `"BACKLOG.md"` | python-local | rest of main |
| scripts/release.sh | 38 | `features` | `"${1:-docs/features.md}"` | bash-local | inside `_enforce_planning_markers` |
| scripts/release.sh | 39 | `backlog` | `"${2:-BACKLOG.md}"` | bash-local | inside `_enforce_planning_markers` |
| scripts/release.sh | 142 | `features_dir_listing` | (content from `printf ... docs/features/*.md \| sed`) | bash-local | line 160 (in prompt heredoc) |

**Total catalog entries: 33** (some files have 2-3 variables, counted independently).

## Special cases / Caveats

### 1. GitHub API URL containing BACKLOG.md (bin/roll:4075)

```
"repos/${slug}/contents/BACKLOG.md?ref=${branch}"
```

This is **not** a local filesystem read — `_loop_pr_claimed_stories` fetches BACKLOG.md content from a *PR branch* via the GitHub API. Tag: `read` direction, but `code-only` from migration perspective *for this branch*; however, the literal `BACKLOG.md` token still has to be renamed in lockstep when BACKLOG.md becomes `.roll/backlog.md`, because the API path must match the renamed file on the remote PR branch.

### 2. Regex patterns extracting `docs/features/<x>` from markdown links

Three locations parse `docs/features/...` out of BACKLOG row content as a regex:

- `bin/roll:5110` — `grep -oE 'docs/features/[^)]+'` inside `_dash_in_progress_story`
- `lib/roll-home.py:170` — `re.search(r"docs/features/[^\)]+", line)`
- `scripts/release.sh:63` — `awk` regex `"(docs/features/" name ".md)"`

These will need to track wherever feature-link convention is renamed. If feature files move to `.roll/features/` and BACKLOG links update accordingly, all three regexes change to `.roll/features/`. Tag: `read`/`code-only`, but high coupling risk — if BACKLOG link convention is changed independently of file location, these regex patterns silently mismatch.

### 3. Heredoc strings inside bin/roll

- Line 2504: `git diff origin/main -- BACKLOG.md ...` is **inside a heredoc** (escaped `\$`) — part of a script template that gets emitted to a child process via heredoc. Renaming BACKLOG.md here renames the path passed to the *child* process. Direction: write (emits the script), but runtime effect is read on BACKLOG.md.
- Line 4520: `grep -qvE '^(BACKLOG\.md|CHANGELOG\.md|PROPOSALS\.md|docs/|\.claude/)'` — regex used against output of `git diff --name-only`. Must update all path tokens together; needs to allow both old and new during the transition window if intermediate commits straddle the rename.

### 4. SKILL.md code blocks vs prose

Skills contain both prose instructions (e.g., "Read BACKLOG.md") and executable bash snippets (e.g., `git add BACKLOG.md docs/dream/...`). Prose can be updated independently; executable snippets must be exact. Treat all SKILL.md path tokens as load-bearing because the skill executor agent will run the snippets verbatim. Particularly important:
- `skills/roll-.dream/SKILL.md:114` — `for f in docs/guide/en/*.md; do` (executable)
- `skills/roll-.dream/SKILL.md:286` — `git add BACKLOG.md docs/dream/YYYY-MM-DD.md` (executable)
- `skills/roll-brief/SKILL.md:65, 102, 168` — bash commands targeting `docs/briefs/`
- `skills/roll-loop/SKILL.md:168, 172` — `bash -c '... "<story-id>" BACKLOG.md'` (passes literal as positional arg)
- `skills/roll-build/SKILL.md:547` — `git add BACKLOG.md docs/features/ CHANGELOG.md`
- `skills/roll-design/SKILL.md:626-638` — variable declarations inside bash code block

### 5. References to `docs/decisions/` (does not exist)

`skills/roll-peer/SKILL.md:247` mentions `docs/decisions/`. No such directory exists in the repo. This is a future-only reference — `code-only`, no migration target needed unless we decide to formalize a decisions log.

### 6. References to `docs/plans/` (deprecated)

`skills/roll-design/SKILL.md:115` says **"no longer using `docs/plans/`"** — explicit deprecation note. No directory exists. Update prose if we want to drop the historical note too.

### 7. AGENTS.md text inside conventions/ is *distributed to user projects*

The strings in `conventions/global/AGENTS.md` and `conventions/templates/*/AGENTS.md` are written into **other people's projects** via `roll init`. After Phase 1, these need to point at `.roll/`. After Phase 2 (US-ONBOARD-011), they may need a different pointer since the user's `.roll/` may live in a separate `roll-meta` repo with cross-repo wiring.

### 8. Test fixtures vs real paths

About half of the test hits are `cat > BACKLOG.md` style fixtures that create files **inside a `TEST_TMP` sandbox**. These don't migrate *files* but they do produce filenames the test then asserts on. Migration plan must update the fixture filenames too, or the test setup will create stale `BACKLOG.md` while the code under test looks for `.roll/backlog.md`.

### 9. Ambiguous: `bin/roll:5167` `backlog=` is a count var, not a path

`backlog=$(grep -E '^\| (\[?US-\|FIX-\|REFACTOR-)' BACKLOG.md ...)` — the variable holds a count, not a path. **False positive** in the variable scan above. Listed for completeness.

### 10. `bin/roll:5110` `link=` extracts `docs/features/` from a row

`link=$(echo "$row" | grep -oE 'docs/features/[^)]+' | head -1 || true)` — extracts the feature-link substring from a BACKLOG row. After migration, this regex must look for `.roll/features/` (assuming BACKLOG link convention follows the file location).

### 11. AGENTS.md tests assert convention text exists

`tests/unit/roll_doc_agents_conventions.bats:7-11` and `tests/unit/agents_md_where_to_look.bats:12` assert that AGENTS.md (real, in `conventions/global/`) contains literal strings like `docs/guide/en/`, `docs/domain/`. When AGENTS.md is updated, the test assertions need synchronized updates. Tag: `read`, but the **test+source must move together** — silent test pass means no protection during the rename.

### 12. `tests/unit/roll_doc_skill.bats:25` asserts SKILL contains `docs/INDEX.md`

This pins the roll-doc skill to write to `docs/INDEX.md`. If we keep INDEX.md inside `.roll/` as the architecture doc suggests (`.roll/index.md`), this test assertion changes.

**RESOLVED 2026-05-19:** `docs/INDEX.md` → `.roll/index.md`. Per design doc §2 ("`docs/INDEX.md` 不在迁移范围——roll-doc 未来产出物，新项目默认写到 `.roll/index.md`"). Update `skills/roll-doc/SKILL.md` to write `.roll/index.md`; update `tests/unit/roll_doc_skill.bats:25` assertion to match. No physical file migration needed (file doesn't exist in this repo).

### 13. Path occurring inside docs/features/refactor-log.md reference (skills/roll-build/SKILL.md:281)

`# 2. Append a brief entry to docs/features/refactor-log.md` — `docs/features/refactor-log.md` is an actual file (verified in inventory). Migrates with `docs/features/` → `.roll/features/`.

### 14. release_features_sync.bats:95 uses `BACKLOG.md` indirectly

```
done < <(grep -oE '^### Feature: [a-z0-9-]+' "${BATS_TEST_DIRNAME}/../../BACKLOG.md" | ...)
```

Reads the real repo BACKLOG.md to drive a test loop. When BACKLOG.md → `.roll/backlog.md`, this absolute reference must update.

### 15. `template/BACKLOG.md` exists as a starter (not just a placeholder string)

`find template -name BACKLOG.md` → `template/BACKLOG.md`. This is a real file shipped as part of the template. The starter content stays semantically the same, but the *destination filename* when `roll init` deploys it changes from `BACKLOG.md` → `.roll/backlog.md`.

**RESOLVED 2026-05-19:** Move `template/BACKLOG.md` → `template/.roll/backlog.md` (and any other `template/*.md` that becomes `.roll/*` in user projects). New-project init must mirror the new convention from day 1 — otherwise `roll init` would create old-structure projects while existing/legacy projects use the new structure. `template/AGENTS.md` stays at root (AGENTS.md is a product artifact, not process).

## Known existing file inventory

Run `find docs/ -type f | sort` (snapshotted):

```
docs/briefs/2026-05-10-11.md
docs/briefs/2026-05-12-01.md
docs/briefs/2026-05-12-02.md
docs/briefs/2026-05-12-03.md
docs/briefs/2026-05-12-04.md
docs/briefs/2026-05-14-01.md
docs/briefs/2026-05-15-01.md
docs/briefs/2026-05-16-01.md
docs/briefs/2026-05-17-01.md
docs/briefs/2026-05-18-01.md
docs/design/idea-023-loop-health-dashboard.md
docs/design/idea-024-upstream-cli-watch.md
docs/design/legacy-onboard-epic.md
docs/design/legacy-onboard-execution-plan.md
docs/domain/autonomous-operation.md
docs/domain/context-map.md
docs/domain/loop-resilience.md
docs/dream/2026-05-11.md
docs/dream/2026-05-12.md
docs/dream/2026-05-14.md
docs/dream/2026-05-15.md
docs/dream/2026-05-16.md
docs/dream/2026-05-17.md
docs/dream/2026-05-18.md
docs/features.md
docs/features/agent-compliance.md
docs/features/alert-lifecycle.md
docs/features/autonomous-evolution.md
docs/features/branch-hygiene-plan.md
docs/features/changelog-integration-plan.md
docs/features/changelog-integration.md
docs/features/cli-redesign-plan.md
docs/features/cli-redesign.md
docs/features/cli-simplification-plan.md
docs/features/cli-simplification.md
docs/features/convention-management.md
docs/features/cycle-event-stream-plan.md
docs/features/cycle-event-stream.md
docs/features/directory-restructure.md
docs/features/documentation.md
docs/features/e2e-lifecycle-plan.md
docs/features/e2e-lifecycle.md
docs/features/github-actions.md
docs/features/hello-world-plan.md
docs/features/hello-world.md
docs/features/landing-page-plan.md
docs/features/landing-page.md
docs/features/legacy-doc-automation-plan.md
docs/features/legacy-onboard.md
docs/features/loop-cost-telemetry-plan.md
docs/features/loop-pr-pipeline-plan.md
docs/features/new-skills.md
docs/features/notifications.md
docs/features/npm-distribution.md
docs/features/opencode-support-plan.md
docs/features/opencode-support.md
docs/features/peer-tmux-cleanup-plan.md
docs/features/peer-tmux-cleanup.md
docs/features/pr-lifecycle-plan.md
docs/features/pr-lifecycle.md
docs/features/refactor-log.md
docs/features/roll-debug-plan.md
docs/features/roll-debug.md
docs/features/roll-meta-migration.md
docs/features/roll-release-plan.md
docs/features/roll-release.md
docs/features/trae-support-plan.md
docs/features/trae-support.md
docs/guide/en/ai-agents.md
docs/guide/en/changelog.md
docs/guide/en/configuration.md
docs/guide/en/conventions.md
docs/guide/en/dream.md
docs/guide/en/faq.md
docs/guide/en/installation.md
docs/guide/en/loop.md
docs/guide/en/methodology.md
docs/guide/en/overview.md
docs/guide/en/peer.md
docs/guide/en/pr-review.md
docs/guide/en/project-setup.md
docs/guide/en/skills.md
docs/guide/en/testing.md
docs/guide/zh/ai-agents.md
docs/guide/zh/changelog.md
docs/guide/zh/configuration.md
docs/guide/zh/conventions.md
docs/guide/zh/dream.md
docs/guide/zh/faq.md
docs/guide/zh/installation.md
docs/guide/zh/loop.md
docs/guide/zh/methodology.md
docs/guide/zh/overview.md
docs/guide/zh/peer.md
docs/guide/zh/pr-review.md
docs/guide/zh/project-setup.md
docs/guide/zh/skills.md
docs/guide/zh/testing.md
docs/intro/roll-introduction-general.html
docs/intro/roll-introduction.html
docs/practices/engineering-common-sense.md
docs/practices/loop-autorun-verification.md
docs/site/cycle-sample.ndjson
docs/site/index.html
docs/site/roll-app.jsx
docs/site/roll-atoms.jsx
docs/site/roll-data.js
docs/site/roll-sections.jsx
docs/site/roll-site.css
docs/site/tweaks-panel.jsx
```

Total: **109 files** under `docs/` to be relocated.

Run `find .roll/ -type f` (on this branch): **directory does not exist**. Confirmed — `.roll/` has no files yet on `worktree-legacy-onboard-epic`.

Run `ls -d BACKLOG.md PROPOSALS.md docs/features.md`: all three exist at repo root, total **3 root-level files** to migrate.

**Grand total physical migration**: 3 root files + 109 docs files = **112 files** to move via `git mv`.
