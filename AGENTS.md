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
- **Rules**: [engineering-common-sense.md](guide/en/practices/engineering-common-sense.md).
- **Test**: bats coverage for `cmd_*` and helpers. Run `npm test` before push.
- **Git hooks**: TCR pre-commit gate is in `hooks/pre-commit`. `core.hooksPath` is auto-configured by `roll setup`, by the autonomous loop at cycle preflight, and by the Claude Code SessionStart hook — no manual step needed. If you clone without setup, run `roll setup` once to wire it up. (US-INFRA-008/009)

## 3. Workflow
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP.
- **Backlog**: Work stems from `.roll/backlog.md`. **Row format is governed by [conventions/global/AGENTS.md §4 Backlog descriptions](conventions/global/AGENTS.md)** — one sentence in plain language, no file paths / function names / architecture jargon; implementation goes in `.roll/features/`. The rule applies equally when working ON Roll as when using Roll.
- **Docs**: [guide/en/skills.md](guide/en/skills.md), [guide/en/methodology.md](guide/en/methodology.md).

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
- **Test-quality design self-check (US-QA-011)**: when adding tests, before
  writing code, confirm:
  1. Each new test calls **project functions / public command entry points** —
     not inline `sed` / `awk` / `grep -o` / `find` / `cut` pipelines that
     duplicate behaviour the project already encapsulates (rubric ❼).
  2. The test sandboxes any filesystem touch through `BATS_TMPDIR` or an
     equivalent project helper — never asserts on or writes to paths outside
     this repo (`~/.codex`, `~/.kimi`, `~/.roll/`, `/etc/`, etc.) (rubric ❽).
  3. The dream nightly scan flags ❼ / ❽ as REFACTOR entries; the loop merge
     gate (US-QA-012) blocks PRs that introduce new violations of those two
     categories. See [guide/en/testing/quality-rubric.md](guide/en/testing/quality-rubric.md).


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
- **Workspace**: `.roll/backlog.md` index. `.roll/features/` for details.
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

**Principle:** 过程默认对内（`.roll/`），产品默认对外（根级）。Process artifacts live inside `.roll/`. Product artifacts (user guides, marketing site) live at the repo root.

**Side judgement:** if AGENTS.md or README references it → product (root). If only internally consumed or auto-generated → process (`.roll/`).

**Directory purposes:**

| Directory | Purpose | Language | Side |
|-----------|---------|----------|------|
| `guide/en/` | User-facing guides (EN source of truth) | English only | product |
| `guide/zh/` | User-facing guides (ZH mirror of EN) | Chinese only | product |
| `guide/{en,zh}/practices/` | Engineering norms referenced externally | matching lang | product |
| `site/` | Marketing site source code | mixed | product |
| `site/slides/` | Promotional materials (HTML intro pages) | mixed | product |
| `.roll/features/` | Story details, AC, design specs | English only | process |
| `.roll/domain/` | DDD domain models and architecture | English only | process |
| `.roll/design/` | Design exploration docs (idea drafts, epic specs) | English | process |
| `.roll/verification/` | Execution records (run logs, verification reports) | English | process |
| `.roll/briefs/` | Owner digests generated by `$roll-brief` | Chinese | process |
| `.roll/dream/` | Nightly scan logs generated by `$roll-.dream` | Chinese | process |

**Language rules:**
- `guide/en/` is the authoritative source — write EN first
- `guide/zh/` is derived — translate from EN after the EN doc is complete
- `.roll/features/`, `.roll/domain/`, `.roll/design/`, `.roll/verification/` are English-only (consumed by AI agents)
- Never mix languages within a single document

**Where to put new docs:**
- New user guide → `guide/en/<topic>.md` (then `guide/zh/<topic>.md`)
- New domain model → `.roll/domain/<model>.md`
- New Story spec → `.roll/features/<feature>.md`
- New design exploration → `.roll/design/<topic>.md`
- New verification record → `.roll/verification/<topic>.md`
- New engineering norm referenced externally → `guide/en/practices/<topic>.md`

**README responsibility boundary:**
- README.md and README_CN.md are navigation hubs — they link to docs, they do not contain content
- Keep both READMEs ≤ 120 lines
- Documentation Index table must include all `guide/en/` and `guide/zh/` files

**Maintenance workflow:**
1. Write or update `guide/en/<topic>.md`
2. Reflect changes in `guide/zh/<topic>.md`
3. Update Documentation Index tables in README.md and README_CN.md if new files were added

## 9. Working with `.roll/` (nested private repo)

> Maintainer-only. Roll itself dogfoods Roll, but the project meta (backlog,
> proposals, features, briefs, dream, design, domain, verification) is private
> and lives in [`seanyao/roll-meta`](https://github.com/seanyao/roll-meta).
> This public repo gitignores all of `.roll/`.

**Layout**
- `~/Workspace/roll/` — outer working tree, tracks `seanyao/roll` (public)
- `~/Workspace/roll/.roll/` — independent nested git repo, tracks `seanyao/roll-meta` (private)
- Outer's `.gitignore` lists `.roll/`; only runtime files (`state/`, `scratch/`, `last-test-pass`, `*.lock`) are also gitignored *inside* the nested repo

**Where to commit what**

| 改动类型 | cwd 改动 | commit + push 去哪 |
|---------|---------|-------------------|
| 代码 / skills / tests / docs | 任意 | `cd ~/Workspace/roll` → roll (public) |
| backlog / proposals / features | 任意 | `cd ~/Workspace/roll/.roll` → roll-meta (private) |
| briefs / dream / design / domain | 任意 | `cd ~/Workspace/roll/.roll` → roll-meta (private) |

**Daily-ops pitfalls (high frequency, easy to miss)**

1. `git status` from outer `roll/` will NOT show `.roll/` changes — the outer git ignores them entirely. After editing backlog/features/etc., always also run `cd .roll && git status` (or you'll never push them).

2. `git add -A` from outer roll/ does not reach into `.roll/`. Have to `cd` first.

3. CI (GitHub Actions, the daemon loop, etc.) cannot see `.roll/`. Don't write tests that assume `.roll/<file>` exists at fresh-checkout time — use TMP/PROJECT_DIR fixtures, as the surviving `cmd_*.bats` tests do.

4. `rg` / `find` / `grep` from outer roll/ root will *not* recurse into `.roll/` automatically (gitignored). To search backlog/etc., pass the path explicitly: `rg pattern .roll/`. Read tool / direct path access works as normal.

5. `git worktree add` of outer roll/ creates a new working dir with an empty `.roll/`. To re-populate: `cd <worktree>/.roll && git init -b main && git remote add origin git@github.com:seanyao/roll-meta.git && git fetch && git reset --hard origin/main`.

6. Do *not* `rm -rf .roll/` from outer roll/ to "clean up" — that destroys the nested `.git/` and its un-pushed history. To resync only working-tree content: `cd .roll && git reset --hard origin/main`.

**New-machine setup**: see roll-meta's README §Setup. The short version:
```
git clone git@github.com:seanyao/roll.git
cd roll/.roll
git init -b main
git remote add origin git@github.com:seanyao/roll-meta.git
git fetch && git reset --hard origin/main
```

This dual-repo model is v2.0 onward. Pre-v2.0 (before commit `f03ddd6`), `.roll/` was tracked in the public repo.
