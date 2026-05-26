# Roll FAQ

Honest answers to the questions people actually ask, organized by where you are
in your journey with Roll:

- **[A. Getting Started](#a-getting-started)** — before/while you try Roll
- **[B. How Roll Compares](#b-how-roll-compares)** — Roll vs. related projects
- **[C. Operating Roll](#c-operating-roll)** — what to do when something gets stuck

---

## A. Getting Started

> **Roll has two surfaces.** Keep them straight as you read this FAQ:
>
> - **CLI commands** — run in your terminal: `roll init`, `roll loop on`,
>   `roll status`, `roll brief`, etc. These manage state, scheduling, and
>   observability. They do not write code themselves.
> - **Skills** — invoked inside your AI agent (Claude Code, Cursor, Codex,
>   Pi, etc.): `$roll-build`, `$roll-design`, `$roll-fix`, `$roll-onboard`,
>   etc. In Claude Code you type them as `/roll-build`; the `$` form is the
>   tool-agnostic way we write them in docs. These are where the agent
>   actually does work.
>
> When you see `roll loop on` in this FAQ, that's a shell command. When you
> see `$roll-build US-001`, that's a skill you invoke from your agent's
> prompt.

### A1. Will Roll modify my code or break my main branch?

**Short answer:** Roll has real guardrails, but the safety story differs
between the two modes — be precise about which you're running.

**The universal guarantee — TCR.** Every commit runs your tests. If tests
fail, the commit is reverted automatically. No broken-test commit can land,
in either mode. This is the foundation everything else builds on.

**Manual mode (`$roll-build`, `$roll-fix`, etc., trunk-based):**

- TCR micro-commits as the agent works
- **Phase 6** runs your full CI locally before any push
- **Phase 7** runs an agent-driven code review of the diff before push
- **Phase 8** pushes to `main` directly — you're sitting in front of the
  agent watching this happen and can stop it at any point
- Your remote CI is the last net: if it goes red after push, you see it
  immediately and fix or revert

**Loop mode (`roll loop on`):**

- Builds on a branch (`loop/cycle-${CYCLE_ID}`) in a worktree
- Opens a PR with `gh pr create --base main`
- Calls `gh pr merge --auto --squash --delete-branch` — the PR auto-merges
  **only when your required CI checks pass**. CI is the gate, not human
  review (by default)
- To require human review before merge, configure required reviewers on
  `main` in GitHub branch protection — `--auto` will then wait on you too

**Either way:** everything is in git history. `git revert` and `git reset`
work normally if you need to undo something.

**Try it manually first:** Open your AI agent (Claude Code, Cursor, Pi,
etc.) in your project and invoke the build skill on a single story:

```text
$roll-build US-001         # in Claude Code: /roll-build US-001
```

Watch design → TCR → local CI → review → push happen in front of you. See
exactly what Roll touches before you trust it with the autonomous loop.

---

### A2. I have an existing project — will Roll work, or will it pollute my code?

**Short answer:** Yes, Roll has a dedicated onboarding flow for legacy code,
and it only writes to its own directory.

**Details:** `roll init` in an existing repo detects existing code and routes
you to `$roll-onboard`. That skill reads your project, asks 9 questions across
cognition / scope / privacy, and writes `.roll/onboard-plan.yaml` as a contract
for `roll init --apply` to execute.

What Roll adds to your repo:

- `.roll/` — backlog, feature specs, config (commit this)
- `.claude/skills/` or equivalent — symlinks to Roll skills (commit this)
- A few entries in `.gitignore`

What Roll does **not** touch: your source code, unless an agent is executing a
story you wrote.

---

### A3. I don't want autonomous runs. Can I drive Roll manually, one story at a time?

**Short answer:** Yes. The loop is opt-in.

**Details:** Without `roll loop on`, Roll is a CLI + skill library. You write a
story in `.roll/backlog.md`, then invoke a skill from inside your AI agent:

```text
$roll-build US-001         # execute a single user story end-to-end
$roll-fix   FIX-002        # execute a single bugfix story
```

(In Claude Code these are typed as `/roll-build US-001` and `/roll-fix FIX-002`.)

Each invocation runs design → TCR → local CI gate → agent self-review → push
to `main` in your foreground; you see every step and can stop at any point.
When the workflow earns your trust, run `roll loop on` in your terminal to
let it pick stories itself (loop mode goes through a PR instead of pushing
to `main` directly — see A1).

---

### A4. What does Roll change on my system, and how do I uninstall cleanly?

**Short answer:** Three places, and `./uninstall.sh` reverses all of them.

**Details:**

- **Global:** `~/.roll/` (your config, primary_agent), `~/.shared/roll/` (loop
  state, `runs.jsonl`). The npm binary lives where your global npm packages do.
- **Per project:** `.roll/`, plus symlinks under `.claude/skills/` (or
  equivalent for other agents).
- **Per project, only with `roll loop on`:** a `launchd` plist on macOS that
  triggers cycles.

To remove everything:

```bash
npm uninstall -g @seanyao/roll
~/.roll/uninstall.sh --dry-run    # preview removals
~/.roll/uninstall.sh              # actually remove
```

---

### A5. How much does a Roll run cost? Can I see token usage?

**Short answer:** Yes — the dashboard shows model + cost per cycle at public
pricing.

**Details:** Since `v2026.521.1`, `roll loop monitor` and `roll loop status`
show the model used and a cost number computed at public per-token pricing.
This is a comparable number, not your bill — your real cost depends on your
subscription tier (Claude Pro, etc.).

Typical ranges per story on Claude Opus 4.x: **$0.5 – $3**, depending on story
complexity and how many TCR iterations the agent burned. Switching to Kimi /
DeepSeek drops this 5–10× at the cost of slower convergence.

**Try it:**

```bash
roll loop monitor                # live dashboard with cost column
roll loop status --days 7        # last 7 days of cycles with cost
```

---

### A6. Do I need to understand DDD / TCR / prompt engineering?

**Short answer:** No, but knowing how to write a good user story helps.

**Details:** Roll's methodology lives inside the skills, not in your head.
`$roll-design` walks you through DDD-style decomposition; `$roll-build` runs
TCR for you; the prompt engineering is encapsulated in the skill files (read
or tweak them if you're curious).

The one thing that matters in *your* head: **how clearly you describe what you
want**. INVEST-shape stories (Independent, Negotiable, Valuable, Estimable,
Small, Testable) work much better than "build me a feature." `$roll-design`
helps you get there from a fuzzy idea.

---

### A7. How detailed should my user stories be? Will Roll cope with a bad one?

**Short answer:** Detailed enough that *you* could code it. Fuzzy stories get
caught and refined before `$roll-build` touches code.

**Details:** A workable story has a value statement (`As X, I want Y, so that
Z`), 2–5 acceptance criteria, and any non-obvious constraints. Don't dictate
implementation — Roll figures that out.

- **Too vague** → `$roll-build`'s `$roll-.clarify` phase surfaces the gaps and
  stops, asking for input.
- **Too complex** → the design phase suggests splitting into smaller stories.
- **Vague-but-runnable** → the agent makes best-effort choices. Often fine for
  prototypes, riskier for production.

**Try it:** Run `$roll-design "add user logout"` and watch it expand a one-line
idea into an INVEST-shaped story with ACs.

---

### A8. What kind of projects is Roll a good fit for? What isn't?

**Good fit:**

- Has a real test suite (TCR depends on it)
- Uses git and a PR-based workflow
- Has CI (GitHub Actions or equivalent)
- Has work you can describe as 1–3 sentence stories
- TypeScript / Python / Go / Bash codebases (best-supported today)

**Bad fit:**

- One-off scripts or throwaway prototypes — overhead > value
- Highly specialized domains (low-level OS, embedded, formal verification)
  where AI agents underperform

**Edge case — legacy codebase with no tests:** This is a bootstrap problem,
not a disqualifier. TCR needs *something* to gate on, so the loop can't run
on a zero-test repo on day one — but recovering this kind of codebase is
exactly what Roll is built to drive. Workflow: run `$roll-onboard` to
reverse-engineer the existing code into a backlog, write
**characterization-test stories first** (pin current behavior with tests
before changing anything), then refactor under TCR once you have a net.
The first few stories are the bootstrap; everything after that runs like
any other Roll project.

---

### A9. Can I use Roll without CI or without GitHub Actions?

**Short answer:** Yes, but you lose the CI gate. TCR and PR still work locally.

**Details:** `roll ci --wait` looks for GitHub Actions on the current commit.
If no CI is configured, Roll degrades gracefully: TCR remains the inner gate
(tests must pass for a commit to stick), PRs are still created, but the loop
won't wait on remote CI before marking a story done.

For pure-local use (no GitHub), Roll still works as a methodology + skill
layer — you just lose the "wait for green before next story" behavior.

---

### A10. Solo or team? How does multi-developer collaboration work?

**Short answer:** Built for solo and pair work first; team usage is possible
but pattern-by-pattern.

**Details:**

- **Solo:** the default. `.roll/backlog.md` is your personal queue.
- **Pair:** commit `.roll/`; your teammate's Roll reads the same backlog. Locks
  are per-machine, so two people running loop in parallel won't collide on
  state but may race on the same story.
- **Team:** treat `.roll/backlog.md` like any source file — coordinate via
  PRs. `roll peer` exists for cross-agent review (one agent reviews another's
  PR). Multi-developer loop coordination (who picks what next) is still a
  rough edge.

Realistic recommendation: in a team, run loop on your own branch/fork, merge
PRs upstream like any human contributor.

---

### A11. After a price update, do historical cycle costs change?

**Short answer:** No. Each cycle's cost is frozen at completion time.

**Details:** When a loop cycle finishes, Roll writes `cost_list_usd` (the
cost at that moment's prices) and `prices_version` (which snapshot was used)
into the usage event. The dashboard reads the frozen value first. Vendor
price changes, `roll prices refresh`, and Roll upgrades never rewrite
historical costs.

Cycles from before this feature shipped (no `cost_list_usd` field) fall back
to computing with the *current* snapshot and show a dim `[legacy]` marker —
so you know those numbers might drift when prices change.

**Try it:**

```bash
roll prices show            # see current snapshot
roll prices refresh         # fetch latest pricing, diff, snapshot if changed
roll loop status --days 7   # historical cycles use frozen costs
```

---

## B. How Roll Compares

### B1. vs. Claude Code's built-in `/loop`, skills, and tasks

**What Claude Code already has:** Skills (custom commands), tasks (in-session
todos), plan mode (review-before-execute), `/loop` (timer that fires a prompt
on an interval).

**Where Roll differs:**

- **Persistent backlog in git.** Roll's `.roll/backlog.md` survives sessions,
  restarts, and model swaps. Claude Code tasks live for one session.
- **Delivery pipeline, not a scheduler.** `/loop` re-fires a prompt every N
  minutes. Roll's loop selects the next ready story, runs DDD → TCR → PR → CI,
  waits for green, then moves on.
- **TCR as a hard gate.** Claude Code's skills are advisory; Roll enforces
  `test && commit || revert` at commit time.
- **Cross-agent.** The same backlog and skills run on Codex, Kimi, DeepSeek,
  Pi, OpenCode. `/loop` only knows Claude.

**Who picks what:**

- Quick interactive sessions, ad-hoc work → Claude Code alone is plenty.
- Long-running projects, unattended progress, hard CI gates → add Roll.

Roll's `roll-*` skills *are* Claude Code skills. Roll layers on top of Claude
Code; it doesn't replace it.

---

### B2. vs. [superpowers](https://github.com/obra/superpowers) (obra)

**What superpowers does well:** A mature 7-stage methodology (brainstorm →
worktree → plan → execute → test → review → finish), broad agent support
(Claude Code, Cursor, Codex, Antigravity, Copilot, Factory, OpenCode), strong
RED-GREEN-REFACTOR enforcement, subagent-driven development. Roll's README
already acknowledges it — several Roll workflow patterns were inspired by it.

**Where Roll differs:**

- **Persistent backlog + autonomous loop.** Superpowers is session-driven —
  you initiate each cycle. Roll has `roll loop on` for unattended runs where
  the next story is picked automatically.
- **CI as a terminal gate.** Roll waits for GitHub Actions green before
  marking a story Done; superpowers leaves CI integration to you.
- **PR-centric output.** Every Roll story ends in a PR linked to your CI.
  Superpowers is more flexible about output shape.

**Who picks what:**

- You want to drive each session yourself with a strong methodology behind
  you → **superpowers**.
- You want unattended forward progress on a backlog with hard CI gates →
  **Roll**.

You can also run Roll alongside superpowers — they overlap but don't conflict.

---

### B3. vs. [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) (Yeachan Heo)

**What oh-my-codex does well:** A sophisticated harness for Codex CLI — tmux
HUD, hooks, agent teams (`$ralplan`, `$ralph`, `$ultragoal`), persistent state
under `.omx/`, durable multi-goal execution via ledger checkpoints. 29k stars,
very active.

**Where Roll differs:**

- **Not Codex-only.** Roll works with Claude / Codex / Kimi / DeepSeek / Pi /
  OpenCode. oh-my-codex is intentionally Codex CLI focused.
- **TCR as a hard gate.** oh-my-codex recommends clarification → planning →
  execution but doesn't enforce TDD/TCR at the commit level.
- **PR + CI as terminal output.** Roll's loop ends each story at "PR merged
  when CI green." oh-my-codex ends at "agent says goal done."
- **Methodology shape.** oh-my-codex emphasizes durable multi-goal execution
  and parallel teams. Roll emphasizes single-story atomicity (one INVEST
  story → one PR → green CI → next).

**Who picks what:**

- Heavy Codex CLI user; want hooks / tmux HUD / multi-agent teams →
  **oh-my-codex**.
- Want cross-agent portability and PR/CI as the success contract → **Roll**.

---

## C. Operating Roll

### C1. Loop is stuck — a story stays "In Progress" and Done is never written

**Symptoms:** `roll loop status` shows `running`, a story sits at
`🔨 In Progress` in BACKLOG for longer than one cycle, or the agent ran
successfully (TCR commits exist) but the story isn't marked `✅ Done`.

**Why this happens:** Loop marks a story `🔨 In Progress` before invoking the
build skill, and only writes `✅ Done` after two hard gates pass: (1) TCR
commit count > 0, (2) CI green via `roll ci --wait`. If the agent crashes mid-
cycle, the LOCK file goes stale, or CI fails, the story stays as-is — by
design, to avoid false-positive completions.

**Under the hood:** Each cycle acquires a per-project LOCK
(`~/.shared/roll/loop/.LOCK-<slug>`). A dead PID is auto-cleaned next cycle.
A live but hung process (e.g. stuck tmux) keeps the LOCK and blocks new
cycles.

**Fix:**

```bash
roll loop status        # check LOCK + PID
roll loop attach        # see what the agent is doing in tmux
roll loop runs          # last cycle outcomes and alerts
roll alert              # any CI or TCR alerts?
roll loop reset         # clear state + LOCK if truly stuck
roll loop now           # trigger a fresh cycle
# If code is done and tests pass but Phase 11 didn't complete:
$roll-build US-XXX      # finish the story manually
```

---

### C2. PR has merge conflicts or rebase fails

**Symptoms:** `gh pr checks` shows "This branch has conflicts" or
`roll loop runs` reports a rebase-failure alert.

**Why this happens:** While the loop built in a worktree, another commit
landed on `main` that conflicts with the PR. The loop's PR inbox tries to
rebase; if both sides touched the same lines, rebase fails.

**Under the hood:** A rebase circuit breaker tracks attempts per PR — after 3
failures within 24 hours, further attempts are blocked and an ALERT is
written. This prevents infinite rebase loops on structural conflicts.

**Fix:**

```bash
gh pr view <number>               # see which files conflict
git fetch origin main
git checkout <pr-branch>
git rebase origin/main            # resolve manually
git push --force-with-lease
# CI re-runs; PR auto-merges when green (if enabled)
```

---

### C3. How do I see what loop did and how much it cost?

**Symptoms:** Loop ran while you were away; you want a quick read of what
happened and what it cost.

**Why this matters:** Roll writes structured records every cycle, but there
are multiple surfaces depending on what you need.

**Under the hood:** Each cycle appends a JSONL record to
`~/.shared/roll/loop/runs.jsonl` with story ID, model, TCR commit count,
duration, outcome, and cost (public pricing). `roll-brief` aggregates this
into a human-readable digest. The tmux session retains the full agent
conversation until the next cycle overwrites it.

**The observability stack:**

| What you want | Command |
|---|---|
| Last N cycle summaries + cost | `roll loop status --days 7` |
| Total spent on one story across all cycles | `roll loop story <ID>` |
| Per-cycle JSONL records | `roll loop runs` |
| Phase breakdown for one cycle | `roll loop runs --detail <cycle_id>` |
| Live dashboard with cost column | `roll loop monitor` |
| Watch the agent in real time | `roll loop attach` |
| Human-readable daily summary | `roll brief` |
| Alerts that need attention | `roll alert` |
| Full cycle agent output (plain text) | `roll loop log` |
| Full agent transcript | `roll loop attach`, scroll up |

`status` rolls the dashboard forward (default 3-day window). When a story took
several cycles spread over a week and you want the total — duration, tokens,
cost, every PR that came out of it — `roll loop story <ID>` reads the full
event stream (including rotated archives `.1` … `.4`) and prints a single panel.

---

### C6. A cycle says phase X took forever — how do I find what slowed it down?

**Symptoms:** `roll loop runs` shows `slowest=claude 96%` on a 45-minute cycle,
or `slowest=pr-wait 80%` on one that seemed to finish quickly. You want to
know which step ate the time before deciding whether to tune anything.

**Why this matters:** Every cycle is sliced into seven named phases
(`startup` / `preflight` / `worktree_setup` / `agent_invoke` / `publish_push` /
`publish_wait_merge` / `cleanup`). The top-line duration alone hides which
one dominated.

**What to do:**

1. Grab the cycle id from the `roll loop runs` row (or from `runs.jsonl`).
2. Print the full breakdown with `roll loop runs --detail <cycle_id>` — phases
   are sorted descending with seconds, percentage, and a bar chart.
3. Common patterns:
   - `agent_invoke` dominating → expected for a multi-file story; nothing
     to tune unless you can split the story.
   - `publish_wait_merge` > 5 min → CI is slow or auto-merge is gated on a
     missing review; check the PR directly.
   - `worktree_setup` > 30 s → likely a slow `git fetch origin`; transient
     network issue.
   - `preflight` > 30 s → previous cycles left orphan worktrees; loop is
     recovering them. Self-heals on next cycle.

The phase tracing data also lives in `runs.jsonl` under the `phases` key
(per-phase seconds), so you can post-process across many cycles.

---

### C4. Multiple projects running loop — are they interfering?

**Symptoms:** Two projects both have `roll loop on` and you suspect they're
stepping on each other.

**Why this happens:** They shouldn't. Each project gets its own LOCK file
(`~/.shared/roll/loop/.LOCK-<project-slug>`), its own `state.yaml` entries,
and its own launchd plist. The slug is `basename + md5(abs-path)`, so even
two projects with the same directory name on different paths get different
locks.

**Fix:**

```bash
# Run in each project directory to see its scheduler + LOCK
roll loop status

# See all active locks across projects
ls ~/.shared/roll/loop/.LOCK-*

# If a stale lock from another project is blocking yours
roll loop reset
```

---

### C5. When does loop auto-recover vs. need a human?

**Loop optimizes for forward progress on clear work. It pauses and tells you
when the work is ambiguous or the environment is broken — never guesses.**

**Auto-recovers (no human needed):**

- Network timeout → retries with backoff (2s, 4s, 8s, 16s)
- Primary agent token exhausted → switches to fallback agent
- Stale LOCK from a crashed process → next cycle cleans it up
- Orphan `🔨 In Progress` from a crashed cycle → next cycle reverts to
  `📋 Todo`

**Needs you:**

- Both primary and fallback agents fail → fix env, then `roll loop resume`
- CI persistently red → fix the failing test/build, then `roll loop now`
- Merge conflict on PR → resolve manually, push
- `gh` auth expired → `gh auth login`
- Story keeps reverting (TCR commit count = 0 every attempt) → the story
  spec is likely unclear; rewrite ACs or run `$roll-build US-XXX` manually
  to see where it stalls

For deeper operational topics (pause/resume, agent switching, gh scopes), see
[loop.md](loop.md) and [configuration.md](configuration.md).

### C7. I changed loop_schedule but loop still runs at the old frequency

**Symptoms:** You updated `.roll/local.yaml` `loop_schedule`, but
`roll loop status` still shows the old trigger times.

**Why this happens:** The launchd plist is written once when you run
`roll loop on`. Changing the config file does not automatically update
the plist.

**Fix:**

```bash
roll loop off && roll loop on     # re-install the plist with new schedule
roll loop status                  # verify the new trigger times
```

### C8. My period_minutes setting is not taking effect

**Symptoms:** You set `period_minutes: 45` in `.roll/local.yaml`, the loop
still runs every hour, and `roll alert` shows a scheduling ALERT.

**Why this happens:** `period_minutes` must evenly divide 60.
Valid values: 60, 30, 20, 15, 12, 10, 6, 5.

**Under the hood:** `_loop_schedule_valid` validates the pair on every read.
An invalid pair triggers an ALERT to `~/.shared/roll/loop/ALERT-<slug>.md`
and falls back to the default (period=60, project-derived offset).

**Fix:**

```bash
roll alert                        # check the exact error
# Edit .roll/local.yaml — use a valid divisor of 60
roll loop off && roll loop on     # re-install
roll loop status                  # confirm the new schedule
```

### C9. What does "sync: offline" mean on the dashboard?

**Symptoms:** The dashboard footer shows `sync: offline` or you're wondering
why `sync: not configured` appears when you haven't set up cross-machine sync.

**Why this matters:** The dashboard sync indicator tells you whether cycle
records from other machines are being merged into your local view.

**Under the hood:** When `roll_records_remote` is configured in
`~/.roll/config.yaml`, every cycle pushes its record to a shared git repo, and
the dashboard pulls from it before rendering. The indicator has three states:

- `sync: ok (2m ago)` — remote reachable, all machines' records merged
- `sync: offline` — remote unreachable (network issue, auth expired); showing
  local data only, other machines' cycles are invisible until connectivity
  returns
- `sync: not configured` — `roll_records_remote` is not set; sync is off by
  design, this is the normal state for single-machine use

**Fix for `sync: offline`:**

```bash
# Check connectivity to the records repo
ssh -T git@github.com           # or your git host

# Verify the remote is still accessible
git ls-remote $(roll config get roll_records_remote)

# If auth expired, re-authenticate
github.com → gh auth login
gitlab.com / self-hosted → check your SSH key

# The dashboard falls back to local-only data while offline —
# no data is lost, it just can't see other machines' cycles
# until connectivity is restored.
```
