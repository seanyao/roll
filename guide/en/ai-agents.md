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
| Trae IDE | (IDE-based) | project_rules.md sync |
| opencode | `opencode` | AGENTS.md sync |
| Qwen | `qwen` | Alibaba Cloud / DashScope |

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
