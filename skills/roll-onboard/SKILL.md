---
name: roll-onboard
license: MIT
description: Interactive onboarding for legacy projects. Reads existing code, understands the project, asks 9 questions in 3 groups (cognition / scope / privacy), and writes .roll/onboard-plan.yaml as the contract for `roll init --apply` to execute.
---

# Roll Onboard

> Follows the Architecture Constraints, Development Discipline, and Engineering Common Sense defined in the project AGENTS.md.

Interactive onboarding flow for **legacy projects**: existing code that needs to adopt the Roll convention without disrupting how the team already works.

## Trigger

This skill runs when:

- `roll init` detected a legacy project (≥10 source files, no `AGENTS.md`)
- The CLI told the user to open an AI agent and run `$roll-onboard`
- The user has now invoked you here

## Hard responsibility boundary

You are the **认知 (cognition) layer**. Your job ends with writing a plan file.

| You do | You do NOT |
|--------|------------|
| Read project code, infer type/domains/modules | Modify any source file |
| Call `roll-doc --dry-run` to get a gap report | Call `roll-doc` (write mode) |
| Ask the user 9 questions across 3 groups | Decide for the user |
| Produce `.roll/onboard-plan.yaml` | Write `.gitignore` |
| Produce `.roll/onboard-plan.yaml` | Run `roll init --apply` |

Hard constraint: **AI cannot create files in the user's project other than `.roll/onboard-plan.yaml`.** Anything else is `bash`'s job (`roll init --apply`).

## Inputs you must read

1. The repository tree (use the project's own structure to infer technologies)
2. Any existing `README.md` / `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` etc. as evidence
3. `roll-doc --dry-run` output → identifies what documentation gaps exist
4. The path-audit pattern: scan for legacy structure markers (`BACKLOG.md`, `docs/features/`, etc.) — if any are present, REFUSE and tell the user to run `roll migrate` first

## Workflow

### Step 0 — Pre-flight

1. Check that you're in a legacy project root (no `AGENTS.md`, has source code)
2. If `BACKLOG.md` or `docs/features/` already present → STOP, tell user to run `roll migrate` first (this is a partial-migration project, not legacy)
3. Check `.roll/onboard-plan.yaml` doesn't already exist; if it does, ask user whether to overwrite

### Step 1 — Read code, build understanding

Walk the repo. Identify:
- **type**: one of `backend-service` / `frontend-only` / `fullstack` / `cli`
- **description**: 1-2 sentence summary of what this project does
- **domains**: top business/technical domains (e.g., "auth", "billing", "search")
- **key_modules**: top 3-5 modules that hold most of the logic

### Step 1b — Phase 2 analysis: business model, tech, tests (US-ONBOARD-016)

A single onboard now produces three structured analysis sections in the plan
(`domain_model`, `tech_analysis`, `test_assessment`). Build them here so Step 4
can serialise them.

**`domain_model`** — from the code you read, identify the bounded contexts. For
each: a `name`, its `aggregates` (the entities that own consistency), and its
`ubiquitous_language` (the domain terms the code/docs actually use). If you
genuinely cannot infer contexts from the code, emit an empty
`bounded_contexts: []` — do NOT invent contexts that aren't in the code.

**`tech_analysis`** — `stack` (languages/frameworks evidenced by manifests),
`dependencies` (from `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`
etc.), `architecture_notes` (observed structure, not aspirational), and `risks`
(each a mapping with a `description`; optionally `severity: LOW|MEDIUM|HIGH` and
an `evidence: detected|inferred` tag).

**`test_assessment`** — this section is under a **hard anti-hallucination
constraint** (next sub-step). Do NOT write it from intuition.

#### The verifiable test scan (ANTI-HALLUCINATION HARD CONSTRAINT)

Every `test_assessment` claim must be backed by a real filesystem scan you run
here — never by "what a project like this usually needs". Run these probes and
record the raw counts/paths:

1. **Count test files** by the conventional patterns:
   - `*.test.*` / `*.spec.*` (JS/TS), `*_test.go` (Go), `test_*.py` / `*_test.py` (Python), `*_spec.rb` (Ruby), `*Test.java` (Java)
   - e.g. `git ls-files | grep -cE '\.(test|spec)\.[jt]sx?$'` and similar per pattern
2. **Probe for runner configs**: `jest.config.*`, `pytest.ini` (or `[tool.pytest]` in `pyproject.toml`), `.mocharc.*`, `vitest.config.*`, `karma.conf.*`, `phpunit.xml`, `go test` (implied by `*_test.go`)
3. **Probe for a `coverage/` directory** (and `.coverage` / `coverage.xml` artifacts)

Then turn the raw findings into claims, each a **mapping** carrying a `claim`
string plus an `evidence` tag:

- `evidence: detected` — the scan directly found it (e.g. "42 `*.test.ts` files detected", "vitest.config.ts present", "coverage/ directory present").
- `evidence: inferred` — a judgement you derived FROM the detected facts (e.g. "unit layer present but no E2E config — integration coverage likely thin"). The inference must trace back to something the scan detected.

**"none detected" rule**: when a probe finds nothing, you MUST say so explicitly
with a tagged claim — `{claim: "none detected", evidence: detected}` (a scan that
ran and returned zero is a genuine `detected` finding). You must NOT silently
omit the dimension, and you must NOT invent generic filler like "needs more E2E
tests" / "consider adding integration tests" with no detected basis. The plan
validator (`lib/roll-plan-validate.py`) rejects any untagged free-text claim, so
filler will fail `roll init --apply`.

Map the findings into the three buckets:
- `current_layers`: what test layers actually exist (each tagged `detected`)
- `gaps`: dimensions where the scan found nothing (`none detected`, tagged `detected`) or thin coverage you can justify (`inferred`)
- `recommended_actions`: actions that trace to a detected gap (tag `inferred`); if nothing is missing, this bucket may be `[]`

### Step 2 — Get gap report

Run `roll-doc --dry-run` (READ-ONLY mode). This reports:
- Which standard Roll artifacts (BACKLOG, features, domain models) are missing
- Which existing docs Roll could `include` rather than regenerate

### Step 3 — Three groups of nine questions

Present these in chat. **Aim for total time ≤ 3 minutes.** Group 1 confirms your understanding; group 2 scopes the work; group 3 handles privacy and next steps.

**$(msg onboard.questions_group1)**

1. $(msg onboard.q1 "[type]" "[description]")
2. $(msg onboard.q2 "[domain A, domain B, …]")
3. $(msg onboard.q3 "[X, Y, Z]")

**$(msg onboard.questions_group2)**

4. $(msg onboard.q4) Multi-select:
   - `backlog` — initial BACKLOG with seeded stories
   - `features` — features index + per-feature spec stubs
   - `domain` — DDD context map
   - `briefs` — directory for `$roll-brief` outputs
5. Of these existing docs, which should I `include` rather than regenerate?
   - (list candidates: README.md, docs/architecture.md, etc.)
6. Put drafts inside `.roll/`? (default: yes; "no" means use the legacy `docs/` layout — not recommended for new adoption)

**Group 3 — Privacy & next steps**

7. Add `.roll/` to `.gitignore`? (yes = keep project management private; no = commit it like Roll itself does)
8. Sync Roll conventions to which AI tools? Multi-select from detected agents (claude / cursor / codex / kimi / deepseek / pi / opencode / agy / trae)
9. Enable `roll loop` autonomous execution after init?

### Step 4 — Write plan file

Write `.roll/onboard-plan.yaml` with this exact schema (validated by `lib/roll-plan-validate.py`):

```yaml
version: 1
generated_at: "2026-05-19T14:30:00+08:00"   # current ISO 8601, your timezone OK

project_understanding:
  type: cli                                  # one of: backend-service / frontend-only / fullstack / cli
  description: "..."
  domains: [...]
  key_modules: [...]

scope:
  approved: [backlog, features, domain]      # user's Q4 multi-select
  declined: [briefs]                         # what they said no to

include_existing:
  - README.md                                # user's Q5 selections
  - docs/architecture.md

privacy:
  gitignore_dot_roll: true                   # user's Q7

sync_targets: [claude, cursor]               # user's Q8
enable_loop: false                            # user's Q9
agent_routes_template: default                # user's Q10 — agent routing preset
                                              # one of: default / minimal / heavy / skip
                                              # default = pi/deepseek/claude + history (US-AGENT-002)
                                              # minimal = single agent (pi), no history
                                              # heavy   = pi/deepseek/claude/kimi + larger window
                                              # skip    = don't seed .roll/agent-routes.yaml

# ── US-ONBOARD-016: Phase 2 analysis sections (optional, but emit all three) ──
# All three are validated only when present, so they are backward-compatible,
# but a normal onboard should produce them from Step 1b.

domain_model:
  bounded_contexts:                          # [] if none can be inferred — never invent
    - name: auth
      aggregates: [User, Session]
      ubiquitous_language: [login, token, refresh]

tech_analysis:
  stack: [bash, python3]                     # evidenced by manifests
  dependencies: [pyyaml]                     # from package.json / pyproject / go.mod / ...
  architecture_notes: ["single-binary CLI + python helpers in lib/"]
  risks:
    - description: "no automated test run on macOS bash 3.2"
      severity: HIGH                         # optional: LOW | MEDIUM | HIGH
      evidence: detected                     # optional: detected | inferred

# test_assessment — ANTI-HALLUCINATION: every claim is a mapping with an
# `evidence` tag (detected | inferred). A zero-result scan is `none detected`
# tagged `detected`. Untagged free-text is REJECTED by the validator.
test_assessment:
  current_layers:
    - claim: "112 bats files detected under tests/"   # evidence: a real scan count
      evidence: detected
  gaps:
    - claim: "none detected"                 # e.g. no coverage/ dir found
      evidence: detected
  recommended_actions:                       # [] if nothing is missing
    - claim: "add a macOS CI runner (inferred from launchd-only test skips)"
      evidence: inferred                     # an inference traceable to a detected fact
```

Then tell the user:

> Onboard conversation done. Plan saved to `.roll/onboard-plan.yaml`.
> Return to your terminal and run:
>
>     roll init --apply
>
> The plan expires in 24 hours.

### Step 5 — Stop

Do NOT run `roll init --apply` yourself. Do NOT modify other project files. Your job is done.

## When NOT to use

- **Not a legacy project**: empty dir or fresh project → use plain `roll init` instead
- **Has BACKLOG.md or docs/features/**: this is a pre-2.0 Roll project → run `roll migrate` first
- **Has .roll/ already**: already onboarded → don't re-run

## Failure modes

- User aborts mid-conversation → don't write partial plan; tell user to re-run from scratch
- User answers contradict the gap report (e.g., declines `features` but has lots of code) → ask the contradictory question once more before accepting; if they confirm, respect the choice
- You can't read enough code to fill `project_understanding` (e.g., binary repo) → write a placeholder plan but ask user to fill in `type` and `description` manually before applying
