# Roll — AI Agent Support

Roll supports multiple AI coding agents. Every agent gets the same conventions
and skills — switching agents does not require changing your workflow.

The `openai` agent name is an alias that dispatches to the Codex CLI (`codex`).
Use `roll agent use openai` to select it — the same binary is invoked.

## Supported Agents

| Agent | CLI command | Notes |
|-------|-------------|-------|
| Claude Code | `claude` | Default primary agent |
| Kimi CLI | `kimi-code` (legacy: `kimi-cli` / `kimi`) | Good fallback; supports peer review. Config dir: `~/.kimi-code/` (legacy `~/.kimi/` still recognized) |
| DeepSeek TUI | `ai_deepseek` | Local or API |
| Codex CLI | `codex` | OpenAI |
| OpenAI (alias) | `openai` | Alias for `codex`. Install: `npm install -g @openai/codex` |
| Antigravity | `agy` | Successor to the Google Gemini CLI; reuses `~/.gemini/` + `GEMINI.md`. Select with `roll agent use antigravity` (legacy alias `gemini` still accepted). Install: `npm install -g @antigravity/agy` |
| Pi (pi-coding-agent) | `pi` | |
| Reasonix | `reasonix` | DeepSeek-native coding agent. Install: `npm i -g reasonix@next`; requires `DEEPSEEK_API_KEY` |
| Trae IDE | (IDE-based) | project_rules.md sync |
| opencode | `opencode` | AGENTS.md sync |
| Qwen | `qwen` | Alibaba Cloud / DashScope |

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

Each agent uses its own default model — there is no model layer to configure.

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
machine's agent choices leaking to another (or into the shared meta repo). There
is no global `primary_agent` / `fallback_agent` config key any more — routing is
entirely per-project complexity slots.

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
Claude, the peer defaults to Kimi or DeepSeek.

See [peer.md](peer.md) for the full peer review workflow.

## See Also

- [configuration.md](configuration.md) — agent config keys
- [peer.md](peer.md) — cross-agent peer review
- [loop.md](loop.md) — complexity-based agent routing in the autonomous loop
