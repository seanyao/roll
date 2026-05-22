# Agent Conventions

> Baseline for AI-agent-friendly projects. Extend with project-specific rules.

## 1. Communication
- User's language. Code/Git/Comments: English. UI: Chinese.
- Concise. No summaries/code-walking. Implementation invisible.
- Strategy (Why) OK; Tactics (How) NO. Outcomes only.
- **Ambiguity resolution**: When user says "explicit" in automation contexts,
  interpret as "logged/observable with clear output", NOT "requiring manual
  intervention". Confirm with one question if uncertain.
- **Voice**: Natural, colleague-like tone — neither robotic ("Executing…") nor over-enthusiastic ("Great!"). "Done — here's what changed." instead of "Task completed successfully." Consistent warmth for success and failure alike.
- **Bilingual output**: EN + ZH on separate lines, never inline.
  ```
  Processing...
  处理中...
  ```
  Not: `Processing... 处理中...`

## 2. Code
- **TS**: Strict, no `any`. Functional hooks. Early returns.
- **Git**: No force-push main. No `--no-verify`. No secrets in git.
- **Identity**: When you need the user's name or email, read it dynamically — `git config user.name` / `git config user.email`. **Never hardcode personal data** (names, emails, machine paths, personal repo URLs) into files that get committed or shipped via npm. Author/repo metadata in `package.json` is the only allowed exception.
- **Behavior**: No unrelated refactoring. No speculative abstractions.
- **File ops**: Prefer targeted edits over full file rewrites. Verify file exists before modifying.

## 3. Engineering
- **Idempotency**: Same op N times = same result.
- **Atomicity**: Complete fully or rollback. No partial state.
- **Validation**: All external input validated. Fail fast on startup.
- **Testing**: Unit >80%. E2E for flows. No DB mocks.

## 4. Workflow
- **Scope Gate**: Only implement what is explicitly listed in the AC. Nothing more.
  - Requests made in conversation are NOT AC — capture with `roll-idea` first.
  - Any new Story/Fix requires design doc + user confirmation before TCR starts.
  - Do not commit without user approval unless explicitly told to auto-commit.
- **Goal First**: Before any implementation, state verifiable success criteria.
  Transform vague tasks: "add validation" → "write test for invalid input, then make it pass".
  Multi-step work: list steps with verify checkpoints (step → verify: how to check).
  Weak criteria ("make it work") require human clarification before starting.
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP commits.
  - Before implementing: confirm exact files, test strategy, and commit message
    draft with user. Do not write code until approved.
  - Before claiming completion: verify in the target environment mentioned by
    user (e.g., specific CLI tool, remote server, hardware platform).
- **Workspace**: `.roll/backlog.md` index. `.roll/features/` for details.
- **Backlog descriptions** (US, FIX, REFACTOR, IDEA, PROPOSAL): one sentence in plain language.
  Say what changed and why it matters — not how it works internally.
  No file paths, function names, parameter lists, or architecture jargon.
  `depends-on:` and `manual-only:` functional tags are allowed; `Domain:` annotation tags are not.
  Technical details and AC go in `.roll/features/`.
  A well-written BACKLOG description can be used directly as a CHANGELOG entry.
- **Convention layering**: project-level convention files extend the global SOT — see §9 below.
- **Done**: Push + CI passes + deployed. Local-only is not done.
- **Post-push verification** (universal — applies to any push to main, regardless of which
  skill drove the work):
  - After every push, wait for the triggered CI run and verify status (`gh run watch`
    or equivalent). Do not move on, switch tasks, or claim completion until CI is green.
  - Before pushing any new code commit, verify the **previous** code-changing push's CI
    is green. Never stack new code commits on top of a red CI (this is the failure
    mode FIX-026 / `_loop_precheck_ci` exists to prevent for the loop — humans need
    the same discipline). Every commit now triggers CI (US-POS-006 removed the
    `paths-ignore` allow-list), so doc-only commits run CI too; treat their result
    the same way as any other push.
  - If CI is red, the next action is **fix or revert**, not "queue something else".
- **Commit message format**:
  - Format: `<type>: <description>` (Git Hook may auto-prepend type prefix)
  - Types: `Story N`, `Fix`, `Refactor`, `Docs`, `Chore`
  - TCR micro-commits use `tcr:` prefix instead

## 5. Refactoring & Renames

Project-wide renames require systematic checking. Never assume find/replace
is sufficient. Execute in order:

1. **Code references** — imports, function names, string literals
2. **Documentation** — README, methodology, API docs
3. **Config files** — YAML frontmatter, package names, manifests
4. **Symlinks** — verify all resolve after rename
5. **Installer scripts** — update paths and references
6. **Shell environment** — remind user to reload or restart sessions

Confirm each phase clean before proceeding to the next.

## 6. Configuration & External Services
- **Config file editing** (YAML/TOML/JSON with schema):
  1. Find official documentation or a verified working example first
  2. Do not guess syntax
  3. If no docs found after 2 searches, ask user for a reference config
  4. Maximum 2 syntax attempts before escalating to research mode
- **External services** (npm publishing, proxy, auth-dependent deploy):
  - Stop after 2 failed attempts and ask user for preferred fallback
  - Do not continue iterating on auth/proxy debugging without explicit direction
  - If OIDC/token issues persist, immediately fallback to manual with explanation

## 7. Frontend Default Stack
- React + shadcn/ui + Tailwind CSS is the default.
- Use shadcn/ui components first. Custom components only when shadcn doesn't cover it.
- `components/ui/` is shadcn-generated — never edit manually.
- Tailwind utility classes only. No inline styles, no CSS modules.
- Icons: Lucide React.

## 8. Where to Look
- **Domain model**: `.roll/domain/context-map.md` — Bounded Contexts and relationships
- **Story details**: `.roll/features/` — AC, implementation specs, dependencies
- **Design decisions**: `.roll/domain/` — DDD models, architecture records
- When `.roll/domain/` or `.roll/features/` don't exist yet, run `$roll-doc` to bootstrap.

## 9. Convention Architecture

Roll conventions form a two-layer hierarchy. The **global** layer is the single
source of truth for **cross-project rules** — rules that apply regardless of
stack, language, or domain (e.g., BACKLOG row format, identity, TCR rhythm,
commit message format, scope discipline). The **project** layer carries only
**project-specific** rules — stack, structure, build commands, domain
conventions, deploy targets.

**The contract:**

1. Every project-level convention file **must declare it extends the global
   counterpart** via a one-line foundation note at the top (e.g., "Extends
   `~/.<agent>/AGENTS.md`" or "Extends AGENTS.md in this directory").
2. Project-level files **never duplicate or re-state** cross-project rules.
   When you find yourself wanting to copy a rule down, add a pointer instead.
3. Cross-project rules go in `conventions/global/`. Project-specific rules go
   in `conventions/templates/<type>/`. Anything that applies regardless of
   stack belongs upstairs.

**Layered file pairs** — each global ↔ project pair must follow the contract:

| Global SOT | Project layer | Audience |
|---|---|---|
| `conventions/global/AGENTS.md` | `conventions/templates/<type>/AGENTS.md` | All agents |
| `conventions/global/CLAUDE.md` | `conventions/templates/<type>/CLAUDE.md` | Claude Code |
| `conventions/global/GEMINI.md` | `conventions/templates/<type>/GEMINI.md` | Antigravity (agy) — reads `~/.gemini/GEMINI.md` natively |
| `conventions/global/project_rules.md` | `conventions/templates/<type>/project_rules.md` | Trae IDE |

The CLAUDE / GEMINI / project_rules global files themselves declare they
extend this AGENTS.md, so this section's rules apply transitively to all
four file families.

**Why it matters**: copies drift, pointers don't. When a rule must change, it
changes in one place and propagates; if it's duplicated, half the copies get
updated and the others silently lag — which is the failure mode that produced
this section in the first place.
