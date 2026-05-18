# Roll Project — Internal Conventions

> ⚠️ **This file is for developers working ON Roll itself.**
> The user-facing baseline — distributed via `roll setup` to `~/.codex/AGENTS.md`,
> `~/.kimi/AGENTS.md`, etc. — lives at [conventions/global/AGENTS.md](conventions/global/AGENTS.md).

> Focus on outcomes.

## 1. Communication
- Respond in user's language. Code/Git/Comments: English. UI: Chinese.
- Concise. No summaries/code-walking. Implementation invisible.
- Strategy (Why) OK; Tactics (How) NO. Outcomes only.
- **Voice**: Natural, colleague-like tone — neither robotic ("Executing…") nor over-enthusiastic ("Great!"). "Done — here's what changed." instead of "Task completed successfully." Consistent warmth for success and failure alike.

## 2. Standards
- **Bash**: `set -euo pipefail`. All variables quoted. shellcheck-clean.
- **Rules**: [engineering-common-sense.md](docs/practices/engineering-common-sense.md).
- **Test**: bats coverage for `cmd_*` and helpers. Run `npm test` before push.
- **Git hooks**: After cloning, run `git config core.hooksPath hooks` once to activate TCR pre-commit enforcement. The hook blocks any commit where tests did not pass on the exact code being committed.

## 3. Workflow
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP.
- **Backlog**: Work stems from `BACKLOG.md`. **Row format is governed by [conventions/global/AGENTS.md §4 Backlog descriptions](conventions/global/AGENTS.md)** — one sentence in plain language, no file paths / function names / architecture jargon; implementation goes in `docs/features/`. The rule applies equally when working ON Roll as when using Roll.
- **Docs**: [guide/en/skills.md](docs/guide/en/skills.md), [guide/en/methodology.md](docs/guide/en/methodology.md).

## 4. CLI
- **Entry**: `bin/roll` — single bash script. No Node runtime. No build step.
- **Tests**: `bats` (`tests/unit/`, `tests/integration/`).
- **Config**: Flags > Env (`ROLL_HOME`, `NO_COLOR`) > File (`~/.roll/config.yaml`) > Defaults.
- **UI**: Human-readable bilingual output (EN + ZH on separate lines).

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
- **Goal First**: Before any implementation, state verifiable success criteria.
  Transform vague tasks: "add validation" → "write test for invalid input, then make it pass".
  Multi-step work: list steps with verify checkpoints (step → verify: how to check).
  Weak criteria ("make it work") require human clarification before starting.
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP commits.
  - Before implementing: confirm exact files, test strategy, and commit message
    draft with user. Do not write code until approved.
  - Before claiming completion: verify in the target environment mentioned by
    user (e.g., specific CLI tool, remote server, hardware platform).
- **Workspace**: `BACKLOG.md` index. `docs/features/` for details.
- **Done**: Push + CI passes + deployed. Local-only is not done.
- **Commit message format**:
  - Format: `<type>: <description>`
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


## 8. Documentation Conventions

**Directory purposes:**

| Directory | Purpose | Language |
|-----------|---------|----------|
| `docs/guide/en/` | User-facing guides (EN source of truth) | English only |
| `docs/guide/zh/` | User-facing guides (ZH mirror of EN) | Chinese only |
| `docs/domain/` | DDD domain models and architecture | English only |
| `docs/features/` | Story details, AC, design specs | English only |
| `docs/practices/` | Engineering practices and verification records | English only |
| `docs/briefs/` | Owner digests generated by roll-brief | Chinese |
| `docs/dream/` | Nightly scan logs generated by roll-.dream | Chinese |

**Language rules:**
- `docs/guide/en/` is the authoritative source — write EN first
- `docs/guide/zh/` is derived — translate from EN after the EN doc is complete
- `docs/domain/`, `docs/features/`, `docs/practices/` are English-only (consumed by AI agents)
- Never mix languages within a single document

**Where to put new docs:**
- New user guide → `docs/guide/en/<topic>.md` (then `docs/guide/zh/<topic>.md`)
- New domain model → `docs/domain/<model>.md`
- New Story spec → `docs/features/<feature>.md`
- New practice or verification record → `docs/practices/<topic>.md`

**README responsibility boundary:**
- README.md and README_CN.md are navigation hubs — they link to docs, they do not contain content
- Keep both READMEs ≤ 120 lines
- Documentation Index table must include all `guide/en/` and `guide/zh/` files

**Maintenance workflow:**
1. Write or update `docs/guide/en/<topic>.md`
2. Reflect changes in `docs/guide/zh/<topic>.md`
3. Update Documentation Index tables in README.md and README_CN.md if new files were added
