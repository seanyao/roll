# Feature: Legacy Project Onboarding

> Part of Epic: Legacy Project Onboarding + 项目管理剥离
> Design doc: [docs/design/legacy-onboard-epic.md](../design/legacy-onboard-epic.md)
> ADRs: PROPOSALS.md (ADR-003, ADR-004)

## US-ONBOARD-006: Legacy 项目识别与 Agent 引导

`roll init` detects legacy projects and guides users to AI agent for onboarding.

**Acceptance Criteria:**
- [ ] Legacy detection triggers when: no `AGENTS.md` AND any of `src/`, `app/`, `lib/`, `pkg/`, `cmd/` has >= 10 non-empty files
- [ ] Agent scanning reuses `_for_each_ai_tool()` (REFACTOR-005)
- [ ] Output lists installed agents with ✓/✗ status
- [ ] Token consumption notice displayed: "uses your agent's API, code stays local"
- [ ] Clear next-step instruction: "run `$roll-onboard` in your agent, then `roll init --apply`"
- [ ] Edge cases:
  - 0 agents → error with link to installation guide
  - 1 agent → skip selection, direct guidance
  - 2+ agents → list options, user chooses by running skill in their preferred agent
- [ ] Non-legacy projects (no source files or AGENTS.md already exists) → existing init path unchanged

---

## US-ONBOARD-007: onboard-plan.yaml 格式定义与校验

Define the contract between `$roll-onboard` skill and `roll init --apply`.

**Acceptance Criteria:**
- [ ] Schema documented: `version`, `generated_at`, `project_understanding`, `scope`, `include_existing`, `privacy`, `sync_targets`, `enable_loop`
- [ ] `lib/roll-plan-validate.py` implemented:
  - Required fields check (version, generated_at, project_understanding.type, scope.approved, privacy.gitignore_dot_roll)
  - `generated_at` freshness check (reject plans older than 24 hours)
  - `version` compatibility check
  - Exit code 0 = valid, non-zero = invalid with human-readable error
- [ ] Bash integration: `roll init --apply` calls validator, checks exit code
- [ ] Missing plan → clear message: "No onboard plan found. Run `$roll-onboard` in your AI agent first."
- [ ] Expired plan → clear message with instruction to re-run `$roll-onboard`

---

## US-ONBOARD-008: `$roll-onboard` 交互技能

Interactive skill that reads the project, asks 9 questions, and produces the onboard plan.

**Acceptance Criteria:**
- [ ] Skill reads project source code and builds understanding (type, domains, key modules)
- [ ] Calls `roll-doc --dry-run` to get gap report (read-only, skill's domain)
- [ ] Three groups of questions (9 total, < 3 minutes):
  - Group 1 (Cognition check): project type, domains, key modules — confirm or correct
  - Group 2 (Scope): which artifacts to generate, existing docs to include, use `.roll/`?
  - Group 3 (Privacy & next steps): `.gitignore` choice (Q7), AI tool sync targets (Q8), enable loop (Q9)
- [ ] Writes `.roll/onboard-plan.yaml` conforming to the schema from Story 7
- [ ] `generated_at` timestamp set to current time
- [ ] Does NOT write any other files — all side effects deferred to `roll init --apply`
- [ ] Reuses `roll-doc` skill capabilities, does NOT reimplement scanning/gap analysis

---

## US-ONBOARD-009: `roll init --apply`（含 .gitignore 写入）

Bash command that consumes the onboard plan and executes all file creation.

**Acceptance Criteria:**
- [ ] Validates plan via `lib/roll-plan-validate.py` (Story 7)
- [ ] Creates `.roll/` directory structure based on `scope.approved`
- [ ] Calls `roll-doc` (write mode, bash's domain) to generate draft content
- [ ] Places generated drafts into `.roll/` subdirectories
- [ ] Respects `include_existing`: listed files are incorporated, not overwritten
- [ ] Respects `scope.declined`: declined artifacts are not generated
- [ ] Writes `.gitignore` based on `privacy.gitignore_dot_roll` — no additional user prompt
- [ ] Syncs AI tool conventions based on `sync_targets` (reuses `_merge_global_to_project` / `_merge_claude_to_project`)
- [ ] Idempotency: re-running on already-onboarded project (AGENTS.md + `.roll/` exist) → skip interaction, section merge only
- [ ] Creates `AGENTS.md` if not present (reuses existing init logic)
- [ ] Summary output: lists all created/skipped files with status indicators
