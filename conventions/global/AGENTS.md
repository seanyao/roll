# Agent Conventions

> Baseline for AI-agent-friendly projects. Extend with project-specific rules.

## 1. Communication
- User's language. Code/Git/Comments: English. UI: Chinese.
- Concise. No summaries/code-walking. Implementation invisible.
- Strategy (Why) OK; Tactics (How) NO. Outcomes only.
- **Ambiguity resolution**: When user says "explicit" in automation contexts,
  interpret as "logged/observable with clear output", NOT "requiring manual
  intervention". Confirm with one question if uncertain.
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
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP commits.
  - Before implementing: confirm exact files, test strategy, and commit message
    draft with user. Do not write code until approved.
  - Before claiming completion: verify in the target environment mentioned by
    user (e.g., specific CLI tool, remote server, hardware platform).
- **Workspace**: `BACKLOG.md` index. `docs/features/` for details.
- **Done**: Push + CI passes + deployed. Local-only is not done.
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
