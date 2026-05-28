---
name: roll-build
license: MIT
description: "Universal delivery skill. Handles any input: a US-XXX ID executes from BACKLOG via TCR; a FIX-XXX redirects to roll-fix; any other text auto-clarifies, designs, and ships as a new Story."
---

# Roll Build (Universal Delivery)

> Follows the Architecture Constraints, Development Discipline, and Engineering Common Sense defined in the project AGENTS.md.

One entry point. Any input. Full delivery.

## Trigger

**Input detection:**

```
Input received
  ├── matches "US-[A-Z]+-[0-9]+"  → Story mode: read BACKLOG → TCR workflow
  ├── matches "FIX-[A-Z]+-[0-9]+" → redirect to $roll-fix
  ├── matches "IDEA-[0-9]+"       → redirect to $roll-idea (lookup and expand)
  └── anything else               → Fly mode: clarify → design → execute
```

**Story mode** — use when:
- The user provides a `US-XXX` identifier
- An existing backlog Story needs to be executed

**Fly mode** — use when:
- The user has a vague one-sentence request
- No `US-XXX` exists yet; planning and execution are both needed
- No input at all — ask the user what they want to build

**Redirect to `$roll-fix`** when:
- Input matches `FIX-XXX` or `BUG-XXX` pattern

Do not use for:
- Pure analysis or research with no code changes (use `$roll-design`)
- Single-line hotfix with no planning needed (use `$roll-fix`)

## Core Philosophy

1. **Clarity over assumptions** — When scope is unclear, clarify first
2. **Just enough planning** — Plan to the level the uncertainty demands
3. **TCR rhythm** — Test-first, micro-steps, auto-commit on green, auto-revert on red
4. **Push to GitHub** — Complete implementation, commit, and push; code is on remote
5. **Stay reversible** — Every micro-step leaves the repo in a clean, green state

---

## Mode A: Story Mode (US-XXX input)

Activate when input is a `US-[A-Z]+-[0-9]+` identifier.

### Step 0: Pre-flight self-check (US-AGENT-007)

Before reading the Story in depth or splitting actions, **read the Agent profile** from the story's feature md and decide whether this cycle can realistically deliver it. The check is mechanical:

```
inputs:
  story.est_min       (from **Agent profile:** block, US-AGENT-001)
  story.risk_zone     (low / medium / high)
  story.chain_depth   (0 unless already a downgrade product)
  agent.max_est_min   (from .roll/agent-routes.yaml for the current agent)
  history.prefer_threshold (from .roll/agent-routes.yaml)
  history.hit_rate    (this agent × this story_type, last window_cycles)

verdict:
  too_big when ANY of these is true:
    1. story.est_min > agent.max_est_min   (hard capacity miss)
    2. story.risk_zone not in agent.risk    (hard risk miss)
    3. history.hit_rate < prefer_threshold AND story.chain_depth == 0
       (soft signal: history says this agent's not on top of this type yet,
        and we still have downgrade budget — don't burn a cycle)
  ok otherwise
```

Output the verdict as the first line of the cycle response:

```yaml
verdict: ok    # or: too_big
reason: <one short line — which condition triggered, with numbers>
```

When `verdict: ok` → continue to Step 1 normally.
When `verdict: too_big` → go to **US-AGENT-008 self-downgrade path** (re-split via `roll-design --from-story <id>`, write sub-stories with `chain_depth + 1`, flip original story to 🚫 Hold, exit cleanly without TCR work this cycle).

> Pre-flight is honest, not paranoid: a small story (est_min ≤ 5, chain_depth=0, low risk) should almost always go `ok`. The check pays off on the long tail — stories that look small but compose tons of files, or that the current agent has historically failed.

### Step 1: Read the Story

1. Open `.roll/backlog.md`, find the US row, follow the link to `.roll/features/<feature>.md`
2. Read the full AC / Files / Dependencies section
3. If a plan doc (`<feature>-plan.md`) exists, read it for context

### Step 2: Split into Actions

- Write 2–6 candidate Actions
- Pick the smallest shippable Action first
- **Granularity constraint**: Each Action completable in 2–5 minutes; split if larger
- **No placeholders**: Action descriptions must be specific and directly executable

#### 2.5 Parallel Dispatch (auto-determined)

After splitting Actions, check if they can run in parallel:

```
Conflict detection:
  ├── List files involved in each Action
  ├── Same file → cannot parallelize, must run sequentially
  ├── Same directory, different files → can parallelize
  └── Different directories → safe to parallelize
```

**If 2+ Actions can run in parallel, automatically enable Worktree isolation:**

```bash
git worktree add .worktrees/{action-id} -b dispatch/{action-id}
```

- Each sub-agent executes TCR in its own worktree
- Sub-agent briefs must be **self-contained** (include: what to do, where, how to verify, what not to do)
- After all complete: review each → merge to main → run integration tests → clean up worktrees

**Status notifications (required):**

```
🔀 $(msg build.parallel_dispatch N)

  $(msg build.agent_running 1 "...")
  $(msg build.agent_running 2 "...")

  $(msg build.agent_done 1 "..." N)
  $(msg build.agent_done 2 "..." N)

🔀 $(msg build.merge_summary N N)
🧪 $(msg build.integration_tests)
```

When parallel conditions are not met, execute Actions sequentially.

### Step 3: Define Verification

- Test matrix: happy path + edge/failure/regression cases
- What "online verification" means for this repo (URL, endpoint, UI flow, log signal)
- Reference `$roll-.qa` for test pyramid (unit → E2E → visual → smoke)

Proceed to the **Shared TCR Workflow** (Phase 4 onward).

---

## Mode B: Fly Mode (free-text or no-input)

Activate when input does not match any `US-XXX` / `FIX-XXX` pattern, or when no input is given.

### Phase 1: Clarify & Assess

Before any code, assess clarity:

```
🎯 $(msg build.clarified_goal): {1-2 sentences capturing user intent}
📏 $(msg build.complexity_assessment): {small|medium|large}
🔍 $(msg build.uncertainty_areas): {list what needs investigation/decision}
```

**If uncertainty areas are non-empty or the request is vague, auto-trigger `$roll-.clarify`:**
- Output the clarification block above
- Follow with 3–5 targeted questions
- Stop and wait for user answers before proceeding

**Approach Confirmation (required for UX / format / automation decisions):**

If the request involves any of: output format, layout, automation level (manual vs automatic), or architecture structure — output a confirmation block **before writing any code**:

```
📐 $(msg build.approach_confirmation)

   1. $(msg build.what_changes): {what will be built or modified}
   2. $(msg build.the_approach): {specific format / automation level / structure chosen}
   3. $(msg build.files_touched): {list of files}

   Proceeding unless you say otherwise.
```

Wait for the user's response before editing files. If the user does not object within one exchange, proceed.

**Complexity Rules (AI coding time):**

| Level | Scope | Action |
|-------|-------|--------|
| Small | ≤3 files, 5–15 min, single concern | Skip detailed planning, implement directly |
| Medium | Crosses modules, needs trade-offs, 15–30 min | Mini-plan then implement |
| Large | Multi-step, architectural, 30–60 min+ | Full plan + split into Actions via `$roll-design` |

### Phase 2: Create US / Actions

- Use `$roll-design` to split vague request into INVEST-compliant User Stories
- Insert US into `.roll/backlog.md` under the relevant Epic > Feature group
- If a new `.roll/features/<feature>.md` is needed, create it

After creation, switch to **Story mode** and execute the first US immediately.

Proceed to the **Shared TCR Workflow** (Phase 4 onward).

---

## Shared TCR Workflow

The following phases apply to both Story mode and Fly mode after planning is complete.

### Phase 3.5: Peer Review Gate

After planning is complete, before entering Test Design Review, assess whether the plan warrants peer review:

**Auto-trigger `$roll-peer` when any of the following is true:**
- Plan affects **>3 files** or **crosses modules**
- **Architecture decisions** or non-obvious trade-offs are involved
- **Destructive / irreversible operations** (deletions, migrations, production deploys)
- **High-risk signal words** detected in user request ("critical / important / don't break / 关键 / 别搞砸")
- User explicitly requests peer review ("/peer", "叫上 peer")

**With 10s opt-out:**
```
Plan affects N files across M modules. Estimated peer review: 2–3 rounds, ~X tokens.
Press Enter to launch peer review, or type 'n' to skip. Auto-executing in 10s...
```

**After peer review result:**
- **AGREE** → proceed to Phase 4 (Test Design Review)
- **REFINE** → incorporate feedback, regenerate plan, re-run Phase 3.5
- **OBJECT** → consider alternative plan, re-run Phase 3.5 with revised proposal
- **ESCALATE** → present both proposals to user for final decision before proceeding

**Never trigger:**
- Single-file changes or well-defined fixes
- Plans with no cross-module impact and no architecture decisions

### Phase 4: Test Design Review

Before writing implementation code:

```
🧪 $(msg build.test_design): {Action name}

   $(msg build.scenarios):
   ├── {Happy path scenario}
   ├── {Edge case scenario}
   └── {Failure/regression scenario}

   $(msg build.test_types):
   ├── Unit tests for: {logic components}
   ├── Integration tests for: {API/data flows}
   └── Manual verification for: {UI/visual elements}
```

**Self-review on test design:**
- Are we testing the right behavior?
- Are edge cases covered?
- Are tests independent and deterministic?

Reference `$roll-.qa` for coverage requirements and test pyramid strategy.

**Why this phase**: TCR only guarantees code passes tests — verify tests are correct first.

### Phase 5: TCR Implementation Loop

```
┌────────────────────────────────────────────────────────────┐
│  $(msg build.tcr_cycle)                                      │
└────────────────────────────────────────────────────────────┘

$(msg build.micro_step {N} "{description of smallest testable change}")

   Step 1: Write/Update Test
      └── Run test → Confirm RED (expected failure)

   Step 2: Implement Minimal Code
      └── Write just enough to make test pass

   Step 3: TCR Decision
      └── Run test
          ├── ✅ GREEN → git commit -m "tcr: {micro-step description}"
          └── ❌ RED   → git checkout -- .  → Retry with new approach

   Step 4: Refactor (optional, while green)
      └── Run test → ✅ GREEN → Amend or new TCR cycle
```

**Micro-step guidelines:**

| Change Type | Typical Micro-Steps |
|-------------|---------------------|
| Logic / algorithm | 1 function = 1–2 micro-steps |
| API endpoint | Route → Handler → Validation → Response |
| UI component | Skeleton → Props → Interaction → Styling |
| Bug fix | Regression test → Fix → Verify |
| Refactor | Extract method → Update calls → Remove old |

Accumulate 3–5 micro-commits per Action. Each commit is a guaranteed working state.

#### Architectural Friction Signal (non-blocking)

While implementing, watch for these signals:

- This Action requires touching code in 3+ unrelated modules
- The existing module boundary has to be bent or bypassed to make this work
- A data structure or interface needs to change in a way that ripples across contexts
- The implementation feels "wrong" even when the test passes

When any signal appears, **do not stop — flag it**:

```bash
# 1. Append to .roll/backlog.md under ## ♻️ Refactor
# REFACTOR-XXX | <one-line description> | 📋 Todo

# 2. Append a brief entry to .roll/features/autonomous-evolution/refactor-log.md
```

**REFACTOR entry format in .roll/backlog.md:**

```markdown
| REFACTOR-001 | {one-line plain-language description} | 📋 Todo |
```

描述写法：参见 AGENTS.md "Backlog descriptions" 规则。说清楚"什么需要改"以及"不改会怎样"，技术细节写在 `.roll/features/autonomous-evolution/refactor-log.md`。

**refactor-log.md entry format:**

```markdown
## REFACTOR-001 Extract payment boundary

**Flagged**: {YYYY-MM-DD} during US-XXX
**Signal**: {which friction signal triggered this}
**Observation**: {1–3 sentences describing what felt wrong}
**Suggested scope**: {rough sense of what a fix would touch}
```

Then continue implementing the current Story normally.

**Event emission** — after all TCR micro-steps for a Story complete, emit a `build` event so the cycle event stream reflects the work done:

```bash
# _tcr_count = number of "tcr:" prefix commits made during this Story
_loop_event build "$US_ID" "${_tcr_count} commits" "" 2>/dev/null || true
```

### Phase 5.5: E2E Deposit

After TCR micro-steps pass, deposit an E2E test for this Story's core user flow.

```
E2E DEPOSIT

   Step 1: Detect
      └── Read project's existing E2E infrastructure
          (test directories, config files, framework, naming conventions)

   Step 2: Write
      └── One E2E test covering the Story's golden path
          (the critical user journey this Story delivers)

   Step 3: Run
      └── Execute the new E2E test

   Step 4: TCR
      ├── ✅ GREEN → git commit -m "tcr: e2e deposit for {story}"
      └── ❌ RED   → Fix via TCR cycle until green
```

**Rules:**
- Follow whatever E2E patterns the project already uses — framework, directory, naming
- If no E2E infrastructure exists, reference `$roll-.qa` "Missing Test Infrastructure" section to bootstrap minimally, then deposit
- One test per Story — covers the golden path, not exhaustive edge cases (those are unit/integration from Phase 5)
- Each deposited E2E becomes a replayable case: CI runs it on every push, Sentinel can sample it against production

### Phase 6: Pre-Push CI Gate

After all micro-steps, run full CI locally before pushing:

```bash
npm run ci:local 2>/dev/null || (npm run lint && npm run build && npm test -- --run)
```

**If CI fails:**
```
❌ Local CI check failed
   ├── Run 'npm run ci:fix' or 'npm run format' for auto-fixable issues
   ├── Fix remaining lint/build/test errors via new TCR cycle
   └── Re-run until all pass
```

**Setup `ci:local` script (if not in `package.json`):**
```json
{
  "scripts": {
    "ci:local": "npm run format:check && npm run lint && npm run build && npm run test -- --run",
    "ci:fix":   "npm run format && npm run lint -- --fix"
  }
}
```

**Setup pre-push hook (recommended, one-time):**
```bash
cat > .git/hooks/pre-push << 'EOF'
#!/bin/bash
echo "🔍 Running local CI checks..."
if ! npm run ci:local 2>/dev/null && ! (npm run lint && npm run build); then
    echo "❌ CI check failed, push blocked"
    exit 1
fi
echo "✅ CI check passed"
EOF
chmod +x .git/hooks/pre-push
```

### Phase 7: Pre-Push Code Review (Three-Axis Deep Review)

This phase runs **once per Story** (not per micro-step) on the full accumulated diff.
Per-micro-step review uses `$roll-.review staged` inline checklist (zero extra cost).

**Phase 3.5 vs Phase 7 split**: Phase 3.5 (Peer Review) focuses on architectural direction
and approach before coding begins. Phase 7 focuses on implementation quality after all
micro-steps are done — catching issues that only appear at diff scale (parameter sprawl
across files, copy-paste patterns, cross-file N+1, etc.).

```bash
# Capture full Story diff
git diff main...HEAD
```

**Launch three review agents in parallel** (each receives the full diff):

```
Agent 1: Reuse Review
  → Search for existing utilities / helpers the new code could use instead
  → Flag any new function that duplicates existing functionality
  → Flag inline logic replaceable by existing tools

Agent 2: Quality Review
  → Redundant state, Parameter sprawl, Copy-paste near-duplicate,
     Leaky abstraction, Stringly-typed, JSX nesting,
     Nested conditionals ≥3 deep, Unnecessary comments

Agent 3: Efficiency Review
  → Redundant computation / N+1, Missed concurrency,
     Hot-path bloat, Loop no-op updates, TOCTOU existence pre-check,
     Memory leaks, Overly broad operations
```

Wait for all three agents to complete. Aggregate findings → fix each issue
(false positives: note and skip, no debate) → summarize what was fixed.

**Fallback**: If parallel agent invocation fails, run `$roll-.review staged` on
the full diff as a single-pass fallback — do not skip review entirely.

**Decision:**
```
🔴 Critical > 0 → Fix via new TCR cycle → Re-review
🟡 Warnings > 0 → Fix if quick (< 5 min) or document
🟢 Suggestions / ✅ All clear → Proceed to Phase 8
```

### Phase 8: Commit & Push

```bash
# All TCR micro-commits are already made
# Squash or keep as-is based on repo convention

git log --oneline -{n}  # Review TCR commits

git pull origin main --rebase
git push origin main
```

Commit message (if squashing):
```
{story-id}: {action description}

- {what changed}
- {why}
- {test coverage}
- TCR: {n} micro-commits
```

### Phase 9: Watch CI & Deploy

```
⏳ CI Running...
   ├── ✅ PASS → Proceed to deploy
   └── ❌ FAIL →
       ├── Diagnose failure
       ├── Create new TCR micro-step to fix
       └── Push and retry
```

Follow the repo's deployment path (Vercel / Railway / etc.) and record the deployed target.

**CI failure recovery:**
```
1. Diagnose: environment-specific or real failure?

2. If real failure:
   ├── git reset --soft HEAD~{n}
   ├── TCR micro-step to fix
   └── Push again

3. If environment-specific:
   ├── Document exception
   └── Get user approval to proceed
```

### Phase 10: Runtime Verification

- **Web apps**: verify on deployed URL (happy path, edge cases, no regression)
- **CLI tools**: verify via command execution
- **Libraries**: verify via test usage or example scripts

### Phase 10.5: Verification Gate (MANDATORY)

**Before marking as DONE, fresh evidence must be provided.**

```
🚦 $(msg build.verification_gate)

   $(msg build.evidence_checklist):
   ├── [ ] $(msg build.tests_passed)
   ├── [ ] $(msg build.build_succeeded)
   ├── [ ] $(msg build.online_verification)
   └── [ ] $(msg build.no_regression)

   $(msg build.gate_decision):
   ├── ✅ $(msg build.gate_pass)
   └── ❌ $(msg build.gate_fail)
```

**Hard Rule**: "I confirmed the tests passed" does not count as evidence. Must be **freshly run** command output from this session.

### Phase 11: Write Back Status (REQUIRED)

Both locations must be updated — neither can be skipped:

**① Update .roll/backlog.md index row (Status column):**

```markdown
| [US-{ID}](.roll/features/<feature>.md#us-{id}) | {Title} | ✅ Done |
```

Change the Status from `📋 Todo` or `🔨 In Progress` (whichever the row currently shows) to `✅ Done`. When invoked by `roll-loop`, the row will already be `🔨 In Progress` — that is the expected starting state, and the transition is the same Edit operation.
For Fly mode: first append an index row under the appropriate Epic > Feature group, then mark it done.

**② Update `.roll/features/<feature>.md` US section:**

```markdown
## US-{ID} {Story Title} ✅

**Completed**: {YYYY-MM-DD}

**AC:**
- [x] {Completed acceptance criterion 1}
- [x] {Completed acceptance criterion 2}

**Files:**
- `{added/modified file 1}`
- `{added/modified file 2}`
```

- Add ✅ to the heading
- Add `**Completed**` date
- Change AC items from `[ ]` to `[x]`
- Update Files to reflect actual changed files

If the US section does not yet exist, create the full section (AC / Files / Dependencies).

**Before committing, run `$roll-.changelog`** to stage CHANGELOG.md — then include
it in the completion commit so no separate changelog commit is created.

```bash
# 1. Stage changelog (roll-.changelog stages CHANGELOG.md only, does not commit)
$roll-.changelog

# 2. Commit BACKLOG + feature doc + CHANGELOG.md together
git add .roll/backlog.md .roll/features/ CHANGELOG.md
git commit -m "docs: mark {US-ID} as completed"
git push
```

### Phase 12: Report & Celebrate

```
✅ $(msg build.pushed_to)
🚀 $(msg build.deployed): <url>
✅ $(msg build.verified): <what was checked>
📦 $(msg build.changes_summary): <summary>
🔢 $(msg build.commits_count): <count> micro-commits via TCR
🧪 $(msg build.tests_added): <what tests were added/modified>
📊 $(msg build.tcr_stats): <success rate, revert count if any>
📋 $(msg build.review_gate): <self-review findings summary>
📝 $(msg build.backlog_updated "<US-ID>")
📄 $(msg build.changelog_bundled)

🎉 $(msg build.shipped)

🔄 $(msg build.next_options):
1. Continue to next Action (if Story has more)
2. Start next US (if Fly mode created multiple)
3. Done (if all completed)
```

---

## Project Context Rule

Before creating any file or directory:

1. **Read existing project structure** — check for `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, existing `src/`, `api/`, `cmd/` directories
2. **Infer conventions from evidence** — don't assume a project type; observe what already exists
3. **Follow what already exists** — introduce new patterns only when the current structure has no precedent

> `roll init` no longer asks for project type. Skills are responsible for reading context and acting accordingly.

---

## Hard Rules

1. **No local-only "done"**
   Work is not complete until it reaches:
   commit → push → CI signal → deploy → online verification → backlog update

2. **TCR for every micro-step**
   - Each behavior change: Test → Green=Commit / Red=Revert
   - No "I'll fix it in the next step" — revert and retry
   - Each commit is a guaranteed working state

3. **Test Design Review before implementation**
   - Design test scenarios and edge cases first
   - TCR only works if tests are correct — validate early

4. **Micro-steps only**
   - If a step feels "a bit complex", split it
   - Each micro-step completable in 1–3 minutes
   - **No placeholders**: Action/AC descriptions must be specific — no "TBD"

5. **Pre-push self-review required**
   - Run `$roll-.review staged` on final diff
   - Fix blocking (Critical) issues via new TCR cycle

6. **No hidden work**
   - Every file changed must relate to the current Action
   - No "while I'm here" refactors unless in a separate TCR cycle

7. **Always update BACKLOG status**
   - .roll/backlog.md index row and `.roll/features/<feature>.md` US section are both required
   - Neither can be skipped

---

## Definition of Done (per Action)

- [ ] Story and Action clearly defined
- [ ] Test design reviewed and approved
- [ ] **TCR cycles completed** (all micro-steps via Test && Commit)
- [ ] **E2E deposited** (golden path test for this Story, committed via TCR)
- [ ] All commits are green states (no broken commits)
- [ ] Local CI checks passed (format + lint + build + test)
- [ ] Self-code-review passed, blocking issues fixed via TCR
- [ ] Changes pushed to remote
- [ ] CI is green (or explicit, recorded exception)
- [ ] Deployed to production
- [ ] Online verification performed
- [ ] **Verification Gate passed** (fresh evidence for tests, build, deploy, no regression)
- [ ] **.roll/backlog.md index status updated** (📋 → ✅, REQUIRED)
- [ ] **`.roll/features/<feature>.md` US section updated** (Completed date + [x] ACs, REQUIRED)
- [ ] **CHANGELOG.md staged and bundled** into completion commit via `$roll-.changelog` in Phase 11 (REQUIRED)
- [ ] Summary reported to user

---

## TCR Recovery Patterns

### Pattern 1: Red After Multiple Attempts

```
If same micro-step fails 3 times:
   1. Revert to clean state
   2. Escalate: "This micro-step is actually medium complexity"
   3. Split into smaller micro-steps
   4. Retry TCR
```

### Pattern 2: Refactoring While Green

```
If refactoring during green state:
   Option A: Amend last commit (if refactor is tiny)
   Option B: New TCR cycle (treat as new micro-step)
```

### Pattern 3: Test Design Was Wrong

```
If implementation reveals test design flaw:
   1. Revert current micro-step
   2. Return to Phase 4 (Test Design Review)
   3. Update test design
   4. Resume TCR cycles
```

### Pattern 4: Complex State vs Simple Reset

```
When complex state management is error-prone → consider full reset + re-initialization.
60% less code, zero bugs is better than an elegant but fragile transition.
```

---

## When to Use What

```
roll-build   → ship anything (new idea, US-ID, free-text request)
roll-fix     → fix a specific known bug (FIX-XXX / BUG-XXX)
roll-design  → plan and design before building (no code output)
roll-idea    → fast capture a bug or idea into .roll/backlog.md
roll-.clarify → passive scope clarification for vague build requests
```

---

## Required Artifacts (per Action)

The agent must explicitly produce (in text) before or during execution:

- **Current User Story**: 1–3 sentences, INVEST-lean
- **Current Action**: smallest shippable increment
- **Acceptance criteria**: measurable outcomes for this Action
- **Write scope**: files/areas expected to change
- **Test Design**: scenarios, edge cases, test types
- **Test Design Review**: coverage validation result
- **TCR Log**: micro-step descriptions and commit count
- **E2E Deposit**: golden path E2E test file for this Story
- **Quality Review**: post-TCR code review result
- **Deployment target**: where it will be verified
