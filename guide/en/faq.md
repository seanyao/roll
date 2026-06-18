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
>   `roll status`, `roll loop watch`, etc. These manage state, scheduling, and
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

- **Global:** `~/.roll/` (your config), `~/.shared/roll/` (loop
  state, `runs.jsonl`). Per-project agent routing lives in `.roll/agents.yaml`.
  The npm binary lives where your global npm packages do.
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

### A4b. I don't have npm or Node.js. Can I still install Roll?

**Short answer:** Yes. The curl install is self-contained and requires only
bash, curl, and tar — all preinstalled on macOS and Linux.

**Details:**

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

No Node.js, no npm, no package manager needed. The script downloads a tarball,
extracts it to `~/.local/share/roll/`, and symlinks `~/.local/bin/roll` into
your PATH. Updates and uninstalls work the same way — `roll update` re-downloads
the latest tarball; `rm -rf ~/.local/share/roll ~/.local/bin/roll` removes
everything.

To pin a specific version (recommended for production):

```bash
curl -fsSL https://seanyao.github.io/roll/install | ROLL_VERSION=v3.610.1 bash
```

---

### A5. How much does a Roll run cost? Can I see token usage?

**Short answer:** Yes — the dashboard shows model + cost per cycle at public
pricing.

**Details:** Since `v2026.521.1`, `roll loop status` shows the model used and
a cost number computed at public per-token pricing.
This is a comparable number, not your bill — your real cost depends on your
subscription tier (Claude Pro, etc.).

Typical ranges per story on Claude Opus 4.x: **$0.5 – $3**, depending on story
complexity and how many TCR iterations the agent burned. Switching to Kimi /
DeepSeek drops this 5–10× at the cost of slower convergence.

**Non-Claude agents:** token/cost capture is per-agent. As of the current
release, cycles run on **Claude, pi (DeepSeek), OpenAI (codex), Gemini, Kimi,
and Qwen** show real token counts and cost. Agents without a usage plugin yet —
notably **OpenCode** — still show `—/—` in the token/cost columns. Support for a
new agent does not appear automatically; it ships as a small per-agent plugin
(see `lib/agent_usage/README.md`).

**Try it:**

```bash
roll loop status                 # scheduler snapshot with cost column
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
into the usage event. The dashboard reads the frozen value first. Vendor price
changes, `roll prices refresh`, and Roll upgrades never rewrite historical
costs.

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

### A12. How do I watch the loop from my phone while I'm away?

**Short answer:** Configure `roll_meta_dir`, then paste
`.roll/prompts/remote-watch.md` into Claude Code on your phone or browser.

**Details:** Once `roll_meta_dir` is set in `~/.roll/config.yaml`, your machine
pushes a `status/loop.md` snapshot to the roll-meta repo after every cycle
(≤35min fresh, idle cycles included as a heartbeat). The remote-watch prompt
reads that snapshot plus the GitHub API and reports loop health, backlog
progress, Dream results, and CI state — read-only, no local `roll` needed. See
[Remote Monitoring](loop.md#remote-monitoring) for setup and troubleshooting.

### A13. What's that coloured summary block in the `.command` window?

**Short answer:** It's the cycle exit summary — a recap of what the cycle just
did, printed right before `press enter to close`.

**Details:** When a cycle ends, the `.command` window renders a
`─── Cycle <id> Summary ───` block covering five signals: the TerminalOutcome
result, CI status (`green` / `red` / `heal-attempting`), todo remaining, the
top phases by time, and any failure / alert highlights (`✗` red for failures,
`⚠` yellow for warnings). A fully green cycle prints in the default colour.
Set `NO_COLOR=1` to disable colour. The `press enter to close` prompt is
unchanged. See
[Cycle exit summary](loop.md#cycle-exit-summary) for the full breakdown.

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
tmux attach -t roll-loop-<project-slug>  # see what the agent is doing in tmux
roll loop runs          # last cycle outcomes and alerts
roll loop alert         # any CI or TCR alerts?
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
`<project>/.roll/loop/runs.jsonl` with story ID, model, TCR commit count,
duration, outcome, and cost (public pricing). `roll loop status` aggregates this
into a human-readable digest. The tmux session retains the full agent
conversation until the next cycle overwrites it.

**The observability stack:**

| What you want | Command |
|---|---|
| Last N cycle summaries + cost | `roll loop status --days 7` |
| Total spent on one story across all cycles | `roll loop story <ID>` |
| Per-cycle JSONL records | `roll loop runs` |
| Phase breakdown for one cycle | `roll loop runs --detail <cycle_id>` |
| Snapshot dashboard with cost column | `roll loop status --days 7` |
| Watch the agent in real time | `tmux attach -t roll-loop-<project-slug>` |
| Human-readable status summary | `roll loop status` |
| Alerts that need attention | `roll loop alert` |
| Full cycle agent output (plain text) | `roll loop log` |
| Full agent transcript | `tmux attach -t roll-loop-<project-slug>`, scroll up |

`status` rolls the dashboard forward (default 3-day window). When a story took
several cycles spread over a week and you want the total — duration, tokens,
cost, every PR that came out of it — `roll loop story <ID>` reads the full
event stream (including rotated archives `.1` … `.4`) and prints a single panel.

---

### C6. A cycle says phase X took forever — how do I find what slowed it down?

**Symptoms:** `roll loop runs` shows `slowest=claude 96%` on a 45-minute cycle,
or `slowest=worktree_setup 40%` on one that seemed to finish quickly. You want
to know which step ate the time before deciding whether to tune anything.

**Why this matters:** Every cycle is sliced into six named phases
(`startup` / `preflight` / `worktree_setup` / `agent_invoke` / `publish_push` /
`cleanup`). The main loop no longer waits for merge (US-AUTO-044) — the
dedicated PR Loop handles that asynchronously — so the top-line duration is
now dominated by `agent_invoke` in almost every cycle.

**What to do:**

1. Grab the cycle id from the `roll loop runs` row (or from `runs.jsonl`).
2. Print the full breakdown with `roll loop runs --detail <cycle_id>` — phases
   are sorted descending with seconds, percentage, and a bar chart.
3. Common patterns:
   - `agent_invoke` dominating → expected for a multi-file story; nothing
     to tune unless you can split the story.
   - PR sitting open / not merging → the dedicated PR Loop (every 5 min)
     handles merge/rebase asynchronously; check the PR's CI or whether it's
     gated on a missing review. This is no longer a main-loop phase.
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
- Routed agent offline (no PATH / auth / network) or token exhausted → swaps to
  the `fallback` slot agent and records `fallback_from` in `runs.jsonl`. The
  downed agent is cached as unavailable (~30 min) so later cycles skip it.
- Stale LOCK from a crashed process → next cycle cleans it up
- Orphan `🔨 In Progress` from a crashed cycle → next cycle reverts to
  `📋 Todo`

**Needs you:**

- Both the routed agent and the `fallback` slot agent are down → an ALERT is
  written and the loop stops (it never loops forever). Fix env, then
  `roll loop resume`
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

**Symptoms:** You set `period_minutes: 0` or `period_minutes: 1441` in
`.roll/local.yaml`, the loop still runs every hour, and `roll loop alert` shows
a scheduling ALERT.

**Why this happens:** `period_minutes` must be 1–1440.
Values outside this range are rejected.

**Under the hood:** `_loop_schedule_valid` validates the pair on every read.
An invalid pair triggers an ALERT to `~/.shared/roll/loop/ALERT-<slug>.md`
and falls back to the default (period=60, project-derived offset).

**Fix:**

```bash
roll loop alert                   # check the exact error
# Edit .roll/local.yaml — use a value 1–1440
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

### C10. I ran roll-doc — how do I know whether it did Phase 3a or Phase 3b?

**Symptoms:** You run `$roll-doc` and want to know whether it stopped at the
directory-level fill (Phase 3a) or went on to the deep cross-directory read
(Phase 3b).

**Why this happens:** Phase 3a (the "Fill" phase) reads each gap directory in
isolation — up to 20 files per gap directory — and emits module READMEs.
Phase 3b ("Deep Read") only fires when the project has cross-directory
structure worth documenting: an import chain spanning ≥ 3 directories, a shared
`*State` / `*Status` enum, external endpoint calls, or a CI config file. A pure
docs-only project with no source gaps and no such characteristics skips
Phase 3b entirely.

**Read the Phase 4 report.** The end-of-run summary always prints both
sections:

```
Phase 3 — Fill
  2 drafts generated: [src/commands/README.md, docs/CONVENTIONS.md]
Phase 3b — Deep Read
  Symbol table: exports(42) imports(156) enums(7) external_urls(4) configs(3)
  2 topic documents generated:
    - docs/data-flows.md     (data-flow)   source entries: 6
    - docs/integrations.md   (external-integration) source entries: 4
```

If Phase 3b found nothing it prints exactly one line —
`Phase 3b: no subject-level drafts generated` — so the absence of any
`docs/data-flows.md` / `docs/state-machines.md` / `docs/integrations.md` /
`docs/deployment.md` output is the tell that only Phase 3a ran. Under
`--dry-run`, the same Phase 3b lines appear tagged `(plan)` and nothing is
written. Full breakdown: [roll-doc.md](roll-doc.md).


---

## Loop runs a cycle but the backlog appears empty

The loop picks stories from `.roll/backlog.md`. If the backlog looks empty
or shows no `📋 Todo` items, the most common causes:

**1. `.roll/` is out of date (new machine or OS reinstall)**

`.roll/` is a separate private git repo (`roll-meta`). After a fresh setup,
clone it manually and point the remote:

```bash
# Replace with your actual roll-meta repo URL
git clone git@github.com:your-org/roll-meta.git .roll
```

**2. SSH key not authorized**

```bash
ssh -T git@github.com   # should say "Hi <username>!"
```

If it fails, re-add your SSH key to GitHub.

**3. Check sync status**

```bash
git -C .roll remote get-url origin  # empty = sync disabled
git -C .roll log --oneline -3        # shows last synced commits
```

**4. Force a manual sync**

```bash
git -C .roll fetch && git -C .roll reset --hard origin/main
```

### C5. Why is this cycle running on `<agent>` instead of my configured default?

**Symptoms:** you expected one agent, but cron.log shows
`[loop] story US-AGENT-007 routed to claude via hard est_min=24 → tier=hard`.

为什么这个 cycle 用了 claude 而不是我以为的那个 agent？

**Why this happens:** routing is now driven by a single axis — **task
complexity**. Each story's `est_min` is classified into one of three tiers
(`est_min ≤ 8 → easy`, `8 < est_min ≤ 20 → default`, `est_min > 20 → hard`;
missing or invalid estimate → `default`), and the tier maps to an agent through
the four slots in `.roll/agents.yaml` (`easy` / `default` / `hard` / `fallback`).
The old three-dimensional matcher (`type` / `est_min` / `risk_zone`) and the
soft-preference history (`runs.jsonl` hit-rate, `cold_start_default`) are
retired. The `via hard`/`via easy` token in the log line is the complexity tier,
not a hard-rule match.

**Inspect:**

```bash
roll agent                            # four slots + online status + recent downgrades
roll agent list                       # which agents this machine has installed
roll loop runs 20                     # see which agent + tier each cycle picked
```

If you want a story to always run on a specific agent, set every tier to the
same agent with `roll agent use <name>` (locks `easy`/`default`/`hard`; the
`fallback` slot is left untouched). To change a single tier, use
`roll agent set <slot> <agent>`.

### C6. Why was my story flipped to 🚫 Hold instead of Done?

**Symptoms:** Backlog row shows `🚫 Hold → split to US-FOO-XXXa,US-FOO-XXXb`,
and there's an ALERT line about `self-downgrade` or `StorySplitCapHit`.

故事为什么翻成 🚫 搁置了，明明 cycle 还跑了？

**Why this happens:** The agent's pre-flight self-check (in
`roll-build` / `roll-fix` SKILL) returned `verdict: too_big` — the story's
`est_min` exceeded the agent's capability range, OR `risk_zone` didn't match,
OR the agent's historical hit rate on that story type is below
`prefer_threshold` and there's downgrade budget left. The cycle then runs
`roll-design --from-story <id>` to write smaller sub-stories with
`chain_depth + 1`, flips the parent to 🚫 Hold, and exits cleanly.

The cap kicks in at `chain_depth ≥ 2` — the third consecutive auto-split is
refused (`StorySplitCapHit`) and ALERT is raised for you to triage manually.

**Fix:** Look at the sub-stories the agent created; they should be smaller and
should pass pre-flight on the next cycle. If you disagree with the split,
edit the sub-stories or flip the original back to 📋 Todo with a tighter
`est_min` / `risk_zone` profile.

### C7. How do I send feedback (bug / idea / UX) without leaving the terminal?

Use the smallest target for the feedback: `roll idea` for the local Roll
backlog, or `gh issue create` when it should become a GitHub issue.

如何不离开终端发送反馈？本地 backlog 用 `roll idea`，公开 GitHub issue 用 `gh issue
create`。

```bash
roll idea "Safari login fails after redirect"
gh issue create --title "Login fails on Safari" --body "Repro: ..."
```

`roll idea` writes to the Roll backlog. `gh issue create` writes to GitHub
and can include the Environment section (roll version / OS / agent / language /
project). See [feedback.md](feedback.md) for the split path.

### C10. Where did my loop state / ALERT go after upgrading? (Phase 2.0)

**Short answer:** Into your project. Since Phase 2.0, a project's loop runtime
data lives at `<project>/.roll/loop/` instead of `~/.shared/roll/loop/`. Your
ALERT is now `<project>/.roll/loop/ALERT-<slug>.md`, state is
`state-<slug>.yaml`, run history is `runs.jsonl`.

升级后我的 loop 状态 / ALERT 跑哪去了？进了你的项目。Phase 2.0 起，项目的 loop
运行时数据放在 `<project>/.roll/loop/`，不再在 `~/.shared/roll/loop/`。

**Do I need to migrate manually?** No. The next cycle migrates legacy files
automatically: `_loop_migrate_legacy_paths` copies state / ALERT / PAUSE / mute
into the project and marks each old file `.migrated-<timestamp>`; `runs.jsonl`
is split per project. During a 7-day window, reads fall back to the old home
path if the new one is missing — so nothing breaks mid-upgrade.

需要手动迁移吗？不需要。下一个 cycle 自动迁移，旧文件标记为 `.migrated-<时间戳>`；
7 天窗口内读取会回退到旧家目录路径作兜底。

**How do I roll back?** The legacy files survive as `<name>.migrated-<timestamp>`
for 7 days. Rename one back (drop the suffix) and delete the project-local copy.

怎么回滚？老文件以 `<name>.migrated-<时间戳>` 保留 7 天，改名回去并删掉项目本地副本
即可。

**Cleaning up debris:** `roll loop gc` retires orphan slugs (project deleted) and
sweeps expired `.migrated-*` markers, `runs.jsonl.tmp.*`, and old backups. Use
`roll loop gc --dry-run` to preview. Full details:
[Loop Data Layout](loop-data-layout.md).

清残骸：`roll loop gc` 退役孤儿 slug、清扫过期 `.migrated-*` 与备份；`--dry-run`
预览。完整说明见 [Loop 数据布局](loop-data-layout.md)。
