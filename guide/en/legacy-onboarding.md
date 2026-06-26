# Legacy Project Onboarding

> Adopt Roll on an existing codebase without breaking your team's current workflow.

If you have a real project that's been alive for a while — code, tests, history, conventions, the works — and you want to start using Roll on it, this is your path.

## Three modes of adoption

| Mode | Use when | Trade-off |
|------|----------|-----------|
| **Seed** | You're starting a brand-new project | Lowest friction; specs/backlog from day 1 |
| **Graft** (this page) | You have a live legacy project that keeps evolving | Zero intrusion on existing code; Roll layered on top |
| **Replant** | You want a clean rewrite, debt cleared | Higher effort; you reverse-engineer specs first |

This page covers **graft**. For seed vs. replant, see [adoption patterns](https://github.com/seanyao/roll-meta) (maintainer-only repo, public summary in the README).

## What graft does

- **Reads** your project to understand type, domains, and key modules
- **Asks** you 9 questions in ≤ 3 minutes
- **Generates** a `.roll/` directory alongside your existing code (no source files touched)
- **Syncs** Roll conventions to whichever AI tools you use
- Leaves you with a project that has BOTH its original workflow AND Roll's project-management capabilities

The graft is **fully reversible**: run `roll offboard` and Roll undoes exactly what it added (see [How to exit](#how-to-exit) below).

## Step by step

### 1. Install Roll

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

Or via npm:

```bash
npm install -g @seanyao/roll@latest
```

Then:

```bash
roll setup
```

### 2. Run `roll init` in your project

```bash
cd your-project
roll init
```

Roll detects this as an existing codebase without Roll (source/manifests exist, but no current Roll markers). It will print something like:

```
Detected: existing codebase without Roll
Recommended path: agentic-onboard
Facts:
  - manifests: package.json
  - source dirs: src
  - test dirs: tests
  - source files: 47
  - Roll markers: none
  - facts hash: sha256:...
Next: $roll-onboard
Agent status: available: claude, codex
Run `$roll-onboard` with an available agent, review the artifacts, then run `roll init --apply`.
No files changed.
```

### 3. Run `$roll-onboard` in your AI agent

Open the agent of your choice (Claude Code, Codex CLI, Cursor, etc.) and run:

```
$roll-onboard
```

The skill will:
1. Walk your repository and tell you what it sees
2. Confirm the inferred project type, domains, key modules (group 1: 3 questions)
3. Ask which `.roll/` artifacts to generate and which existing docs to include (group 2: 3 questions)
4. Ask about `.gitignore`, AI tool sync, and loop activation (group 3: 3 questions)
5. Write exactly two structured artifacts: `.roll/init-diagnosis.yaml` and `.roll/onboard-plan.yaml`

Total time: under 3 minutes.

### 4. Apply the plan

Back in your terminal, review `.roll/init-diagnosis.yaml` and `.roll/onboard-plan.yaml`, then run:

```bash
roll init --apply
```

This validates the paired diagnosis/plan artifacts before writing anything. It rejects unsupported schema versions, stale facts hashes, non-idempotent file operations, path traversal, and shell-command keys.

After validation, Roll prints an apply review checkpoint. The table lists every
planned operation with action, target path, merge/create mode, and whether owner
content is preserved. In an interactive terminal, Roll waits for confirmation
before writing any reviewed mutation.

For non-interactive automation, use the explicit review acknowledgement after you have reviewed the artifacts:

```bash
roll init --apply --auto
```

After validation passes, Roll:
- Creates `.roll/` subdirectories per your scope choices
- Generates a starter `.roll/backlog.md` if you said yes
- Includes (not regenerates) the existing docs you flagged
- Adds `.roll/` to `.gitignore` if you said yes
- Syncs Roll conventions to the AI tools you picked

Done. Run `roll status` to see the new state.

### 5. (Optional) Turn on autonomous loop

If you said "yes" to Q9, `roll loop on` activates the autonomous executor on a cron schedule. It picks up `📋 Todo` items from `BACKLOG.md` and runs `$roll-build` / `$roll-fix` on them.

## The graft boundary

Roll only touches **its own** files inside your project:

| Touched by Roll | Not touched by Roll |
|-----------------|---------------------|
| `.roll/` (all contents) | `src/`, `lib/`, `tests/`, etc. — your code |
| `AGENTS.md` (created if missing; section-merged if exists) | `README.md` |
| `.gitignore` (only if you said yes to Q7) | `package.json`, `pyproject.toml`, etc. |

If you've already got a `CONTRIBUTING.md` or a `.github/` workflow, Roll won't reach into them. If you want Roll's workflow integrated with yours, that's a manual step you do later.

`$roll-onboard` itself has a stricter boundary than `roll init --apply`: the agent may only write `.roll/init-diagnosis.yaml` and `.roll/onboard-plan.yaml`. The apply command owns `AGENTS.md`, `.gitignore`, backlog, features, docs, and offboard changesets.

## How to exit

`roll init --apply` records every file, directory, and `.gitignore` line it adds into `.roll/onboard-changeset.yaml`. The `roll offboard` command reads that record and undoes exactly those changes.

**Preview what will be undone (default):**

```bash
cd your-project
roll offboard
```

This is a dry-run — no files are removed. The output lists every artefact the changeset recorded and the `.gitignore` lines that will be reverted.

**Apply the rollback:**

```bash
roll offboard --confirm
```

Files and directories that Roll did not create are left untouched. Lines you added to `.gitignore` yourself are preserved. The changeset file itself is removed at the end of a successful apply.

Safety:

- If `.roll/onboard-changeset.yaml` is missing (e.g. you ran an earlier Roll version that didn't track it, or the project was never onboarded with `roll init --apply`), `roll offboard` refuses and prints the manual `rm` commands instead. It will never guess.
- If the changeset names paths that resolve outside the current project (cross-project contamination), `roll offboard` refuses and tells you to run it in the right directory.

**Full uninstall (machine-wide):**

```bash
roll offboard --confirm
npm uninstall -g @seanyao/roll
```

Your project is now exactly as it was before adoption.

## FAQ

**Q: What if I don't have an AI agent installed?**
You need at least one. Install Claude Code, Codex CLI, or Cursor — they're free to install (the AI calls cost tokens via your account).

**Q: What if I already have a `BACKLOG.md` from another tool?**
Roll detects this as a pre-2.0 Roll project (not a legacy project) and tells you to run `npx @seanyao/roll@2 migrate`. If the file came from a totally different tool, rename it first (`mv BACKLOG.md old-backlog.md`) then run `roll init`.

**Q: Roll-onboard infers my project type wrong — what do I do?**
Tell the skill in chat. Group 1 questions exist specifically so you can correct misidentification. The skill writes the corrected understanding into the plan; bash trusts the plan.

**Q: Can I edit `.roll/onboard-plan.yaml` manually?**
Yes, but keep it paired with `.roll/init-diagnosis.yaml`. `roll init --apply` requires matching `factsHash` values, recomputes the current facts hash, allows no shell-command keys, and only accepts the two idempotent `file_operations` entries rooted inside the project. Plans older than 24 hours, stale against the current project, or generated by older `$roll-onboard` contracts should be regenerated.

Manual edits still pass through the same review checkpoint; without interactive
confirmation or explicit `--auto`, no files are changed.

**Q: My team uses GitHub Issues / Jira / Linear — does Roll replace them?**
No. Roll's `BACKLOG.md` is for AI-driven autonomous execution. Your team's external tracker stays where it is. Some teams use Roll only for new stories that are AI-loop-executable and keep human-only work in their existing tracker.
