# Roll — AI Agent Support

Roll supports multiple AI coding agents. Every agent gets the same conventions
and skills — switching agents does not require changing your workflow.

## Supported Agents

| Agent | CLI command | Notes |
|-------|-------------|-------|
| Claude Code | `claude` | Default primary agent |
| Kimi CLI | `kimi` | Good fallback; supports peer review |
| DeepSeek TUI | `ai_deepseek` | Local or API |
| Codex CLI | `codex` | OpenAI |
| Antigravity (agy) | `agy` | |
| Pi (pi-coding-agent) | `pi` | |
| Trae IDE | (IDE-based) | project_rules.md sync |
| opencode | `opencode` | AGENTS.md sync |
| Qwen | `qwen` | Alibaba Cloud / DashScope |

## Switching Agents

```bash
roll agent use kimi      # set project agent to kimi
roll agent use claude    # switch back to claude
roll agent list          # show all detected agents and current selection
```

The active agent is stored in `.roll.yaml` at the project root. Each roll skill
(`$roll-build`, `$roll-fix`, etc.) routes to the configured agent automatically.

## Per-Project vs Global

- **Project-level** (`.roll.yaml`): applies only to this project.
- **Global** (`~/.roll/config.yaml`): used when no `.roll.yaml` is present.

```yaml
# ~/.roll/config.yaml
loop:
  primary_agent: claude
  fallback_agent: deepseek
```

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
- [loop.md](loop.md) — `loop.primary_agent` / `loop.fallback_agent`
