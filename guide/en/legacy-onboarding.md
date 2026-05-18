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

The graft is **fully reversible**: `rm -rf .roll/` and you're back to where you started.

## Step by step

### 1. Install Roll

```bash
npm install -g @seanyao/roll@latest
roll setup
```

### 2. Run `roll init` in your project

```bash
cd your-project
roll init
```

Roll detects this is a legacy project (no `AGENTS.md`, but you have substantive source code). It will print something like:

```
[Roll] Detected: legacy project (no AGENTS.md, 47 files in src/)

[Roll] Onboarding requires an AI agent to read your code. Detected:
  ✓ claude    (installed)
  ✓ codex     (installed)
  ✗ kimi      (not found)

[Roll] Onboarding uses your agent to call models — tokens are billed to your
       account. Your code and conversation stay in your agent — Roll never
       uploads anything.

[Roll] Next step:
         Open any installed agent and run:    $roll-onboard
       After the conversation, return and run:
         roll init --apply
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
5. Write `.roll/onboard-plan.yaml` summarizing all your answers

Total time: under 3 minutes.

### 4. Apply the plan

Back in your terminal:

```bash
roll init --apply
```

This reads the plan and:
- Creates `.roll/` subdirectories per your scope choices
- Generates a starter `BACKLOG.md` if you said yes
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

## How to back out

Two options:

**Light reversal** (keep Roll installed, drop adoption on this project):

```bash
rm -rf .roll/ AGENTS.md
# also revert .gitignore if Roll modified it
```

**Full reversal** (uninstall Roll globally):

```bash
rm -rf .roll/ AGENTS.md
npm uninstall -g @seanyao/roll
```

Your project is now exactly as it was before adoption.

## FAQ

**Q: What if I don't have an AI agent installed?**
You need at least one. Install Claude Code, Codex CLI, or Cursor — they're free to install (the AI calls cost tokens via your account).

**Q: What if I already have a `BACKLOG.md` from another tool?**
Roll detects this as a pre-2.0 Roll project (not a legacy project) and tells you to run `roll migrate`. If the file came from a totally different tool, rename it first (`mv BACKLOG.md old-backlog.md`) then run `roll init`.

**Q: Roll-onboard infers my project type wrong — what do I do?**
Tell the skill in chat. Group 1 questions exist specifically so you can correct misidentification. The skill writes the corrected understanding into the plan; bash trusts the plan.

**Q: Can I edit `.roll/onboard-plan.yaml` manually?**
Yes. As long as it passes `lib/roll-plan-validate.py` (run by `roll init --apply`) and is < 24h old, bash will execute it. Edit `description` or correct `domains` before applying.

**Q: My team uses GitHub Issues / Jira / Linear — does Roll replace them?**
No. Roll's `BACKLOG.md` is for AI-driven autonomous execution. Your team's external tracker stays where it is. Some teams use Roll only for new stories that are AI-loop-executable and keep human-only work in their existing tracker.
