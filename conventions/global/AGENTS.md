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
- **Behavior**: No unrelated refactoring. No speculative abstractions.

## 3. Engineering
- **Idempotency**: Same op N times = same result.
- **Atomicity**: Complete fully or rollback. No partial state.
- **Validation**: All external input validated. Fail fast on startup.
- **Testing**: Unit >80%. E2E for flows. No DB mocks.

## 4. Workflow
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP commits.
  - Before implementing: confirm exact files, test strategy, and commit message
    draft with user. Do not write code until approved.
  - Before claiming completion: verify in the target environment mentioned by
    user (e.g., specific CLI tool, remote server, hardware platform).
- **Workspace**: `BACKLOG.md` index. `docs/features/` for details.
- **Done**: Push + CI passes + deployed. Local-only is not done.

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
