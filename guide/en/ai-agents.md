# Roll — AI Agent Support

Roll supports multiple AI coding agents. Every agent gets the same conventions
and skills — switching agents does not require changing your workflow.

## Default Agent (`primary_agent`)

`roll setup` and `$roll-onboard` now let you pick a default agent from the ones
installed on your machine. The choice is stored as `primary_agent` in
`~/.roll/config.yaml`.

Where `primary_agent` is used:
- **Interactive entry points** — `roll design`, `roll agent use`, and onboard
  flows default to it. If you have only one agent installed, it is set
  automatically.
- **`roll doctor`** — shows the current primary.

Where it is **not** used:
- **The autonomous loop** — complexity-based routing reads
  `.roll/agent-routes.yaml` independently. Your interactive default and your
  loop rig pool are intentionally separable. For example, you might use
  `claude` for interactive design sessions but route loop work through
  `kimi`/`pi`/`reasonix`.

`primary_agent` can differ from the agent you configure for the `default`
complexity slot — this is by design, not a misconfiguration.

## Supported Agents

| Agent | CLI command | Notes |
|-------|-------------|-------|
| Claude Code | `claude` | Default primary agent |
| Kimi CLI | `kimi-code` (legacy: `kimi-cli` / `kimi`) | Good fallback; supports peer review. Config dir: `~/.kimi-code/` (legacy `~/.kimi/` still recognized) |
| Codex CLI | `codex` | OpenAI; the `openai` alias still resolves to codex. Install: `npm install -g @openai/codex` |
| Antigravity | `agy` | Successor to the Google Gemini CLI; reuses `~/.gemini/` + `GEMINI.md`. Select with `roll agent use antigravity` (legacy alias `gemini` still accepted). Install: `npm install -g @antigravity/agy` |
| Pi (pi-coding-agent) | `pi` | The `deepseek` alias still resolves to pi. |
| Reasonix | `reasonix` | DeepSeek-native coding agent. Install: `npm i -g reasonix@next`; requires `DEEPSEEK_API_KEY` |

For unattended loop runs, agent credentials are checked before the selected
agent is spawned. Reasonix may get `DEEPSEEK_API_KEY` from the environment or
from `~/.reasonix/.env`; if both are absent, Roll writes an `agent:blocked`
auth event and an ALERT that names `reasonix` and `DEEPSEEK_API_KEY` before it
burns a cycle. The check runs only after a concrete builder, reviewer, scorer,
or ac-map remediation agent has been selected, so an optional unused agent with
missing credentials does not pause the loop.

## Adding an Agent

Agent-specific behavior belongs in one profile, not in downstream runner gates.
To add or adjust an agent:

1. Add the public registry entry in `packages/core/src/agent/specs.ts`.
2. Add or update the runner profile in `packages/cli/src/runner/agent-spawn.ts`.
   The profile owns argv construction, workspace-sandbox consumption, PTY
   wrapping, headless-review capability, and any child environment hook.
3. Keep `executor.ts`, attest gates, and test routing code agent-agnostic. They
   call `agentProfile(name)` or `agentSpawnEnvironment(name)` instead of
   checking concrete agent names.
4. Add unit coverage for the profile and the registry entry.

## Complexity Routing (four slots)

Roll routes work to an agent by **task complexity**. A story's `est_min` is
classified into one of three tiers, and each tier maps to an agent through four
slots in `.roll/agents.yaml`:

```yaml
schema: v3
easy:     { agent: kimi }      # est_min <= 8
default:  { agent: kimi }      # 8 < est_min <= 20  (also the catch-all)
hard:     { agent: claude }    # est_min > 20
fallback: { agent: pi }        # used when the picked agent is offline
```

Each assignment is a rig: `agent × model`. The agent is one of the six supported
identities; the model is a string owned by that agent. For example, `pi` may run
`deepseek-v4-pro`, but `deepseek` is not an agent slot value.

```bash
roll agent                # show the four slots + online status + recent downgrades
roll agent list           # show all detected agents installed on this machine
roll agent set hard claude   # set the agent for one slot
roll agent use kimi       # lock easy/default/hard to one agent (fallback unchanged)
```

`roll agent use <name>` keeps the old single-agent ergonomics — it just now
means "lock all three complexity tiers to this agent". Each roll skill
(`$roll-build`, `$roll-fix`, etc.) and the loop route through these slots
automatically.

## Per-Machine, Not Committed

`.roll/agents.yaml` is **per-machine**: it is listed in `.roll/.gitignore` and is
never committed, so each machine manages its own agent slots. This avoids one
machine's agent choices leaking to another (or into the shared meta repo).

The `primary_agent` in `~/.roll/config.yaml` (set by `roll setup` / onboard) is
also per-machine and governs interactive defaults. Loop routing, by contrast,
uses `.roll/agents.yaml` independently — see the [Default Agent](#default-agent-primary_agent)
section above for the separation.

## Scoring and Pairing Respect the Same Slots

The agents declared in `.roll/agents.yaml` also act as the project-config
allowlist for peer scoring and cross-agent pairing. A machine may have additional
agents installed (for example, `codex` or `claude`), but scoring and pairing only
auto-enable agents that are configured in the slots. This keeps unattended review
and score pools aligned with the project's declared agent roster instead of
drifting with whatever happens to be installed.

## Adaptive Soft Priority (in-tier nudge)

On top of the complexity tier — which is a **hard** constraint that decides
which slot is consulted — Roll applies a **soft priority** that can reorder the
candidate agents *within the same tier* by their historical hit-rate. This is
the transparent, auditable successor to the old (retired) history preference.

How the nudge is computed:

- **In-tier only.** The tier (`easy` / `default` / `hard`) is never changed. A
  task is never moved to a different tier; only the agent inside the resolved
  tier may be reordered.
- **Per (agent × story type).** The hit-rate is looked up per agent and story
  type (the story id prefix, e.g. `US` / `FIX`), from the cycle history in
  `runs.jsonl` via `result_eval`.
- **Sample floor.** A (agent × story type) combo with fewer than 8 samples is
  ignored — below that it is statistically meaningless, so the est_min slot
  agent is kept and the audit line says so.
- **Deterministic.** Same history in → same agent out. No random numbers, no
  time seed, no decay clock. The reorder is a pure function of its inputs and is
  reproducible from fixed test inputs.

Where to read the nudge reason:

- The router emits a human-readable rationale, e.g.
  `kimi in-tier hit_rate 0.82 (n=14) > slot claude 0.61 (n=11) for US -> prefer kimi`.
- The loop prints it on the `[loop] story … routed to …` line, records it in the
  event log (`story_routed`), and the routed agent + complexity `tier` are
  first-class columns in `runs.jsonl`.

How to turn it off:

- Set `ROLL_AGENT_NUDGE=0` (also accepts `off` / `false` / `no`). With the nudge
  disabled, routing behaves **exactly** like the pure est_min slot routing — the
  resolved slot agent is used unchanged, with no reordering.

How this differs from the **retired** soft preference: the old history
preference was implicit, unpredictable, and not explainable. This one is
**deterministic, auditable, and one-switch off** — it can only reorder agents
inside a tier, never silently move work across tiers.

## Convention Sync

`roll setup` copies global conventions (`AGENTS.md`, `CLAUDE.md`) into each
detected AI tool's expected directory. After adding a new agent, re-run:

```bash
roll setup
```

## Peer Review with Multiple Agents

`$roll-peer` routes a design or code decision through a second AI agent for a
cross-check. The routing uses the capability map — if your primary agent is
Claude, the peer defaults to Kimi or Reasonix.

See [peer.md](peer.md) for the full peer review workflow.

## See Also

- [configuration.md](configuration.md) — agent config keys
- [peer.md](peer.md) — cross-agent peer review
- [loop.md](loop.md) — complexity-based agent routing in the autonomous loop
