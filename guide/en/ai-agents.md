# Roll — AI Agent Support

Roll treats AI agents as a scoped pool of execution identities. The current
model is:

```text
Scope -> Role -> Binding -> Agent -> optional Model
```

The same shape repeats at every level. A machine can declare the agents it has,
a project can bind roles for its work, and a story or skill can narrow those
bindings when needed.

## Agent-Domain Files

- `~/.roll/agents.yaml` is Machine Scope. It declares the local agent pool and
  machine-level roles such as `supervise`.
- `.roll/agents.yaml` is Project Scope. It binds project/story roles such as
  `supervise`, `execute`, and `evaluate`.

`~/.roll/config.yaml` may still exist for generic preferences and legacy
migration input, but it is no longer the primary authoring surface for agent
semantics. Use:

```bash
roll agent                      # show Machine Scope, Project Scope, roles, pool, and legacy inputs
roll agent migrate --dry-run    # preview conversion from legacy files
roll agent migrate              # write roll-agents/v1 files
roll agent list                 # show installed agents
```

## Roles

Roll uses three core Agent-domain roles:

- `supervise` — coordinates at project level. In guided mode this may be the
  current agent session you are talking to; in autonomous mode Roll resolves the
  role and drives the loop.
- `execute` — builds or fixes a story through the selected skill workflow.
- `evaluate` — reviews, scores, or checks the delivery in a fresh session.

Project defaults normally bind story roles:

```yaml
schema: roll-agents/v1
scope: project
inherits: machine
defaults:
  story:
    roles:
      execute:
        kind: select
        from: [kimi, codex, pi]
        require: [execute]
        strategy: first-available
      evaluate:
        kind: select
        from: [claude, codex, kimi, pi, agy, reasonix]
        require: [evaluate]
        avoid: [execute]
        strategy: least-recent
```

Machine scope can declare a supervisor and the local pool:

```yaml
schema: roll-agents/v1
scope: machine
agents:
  codex:
    capabilities: [supervise, execute, evaluate]
  kimi:
    capabilities: [execute, evaluate]
roles:
  supervise:
    use: codex
```

## Fair Eligibility

Static config lists fair candidates. It should not permanently exclude a
supported agent because of an old auth, VPN, account, or network incident.
Runtime health is checked when Roll resolves or spawns the role:

- unavailable candidates are skipped for the current resolution;
- the skip is recorded as a runtime fact;
- the static pool remains fair until you intentionally narrow it.

Unknown or unregistered agent names fail loud during config parsing.

## Guided vs Autonomous Mode

In guided mode, you can keep working in the current agent window. That session
acts as the supervisor front door: it can inspect `roll agent`, run migrations,
and ask Roll to continue through the CLI.

In autonomous mode, you do not open multiple agent windows manually. The loop
resolves `supervise`, `story.execute`, and `story.evaluate`, then spawns fresh
agent sessions for the roles through the configured bindings.

## Supported Agents

| Agent | CLI command | Notes |
|-------|-------------|-------|
| Claude Code | `claude` | Anthropic coding agent. |
| Kimi CLI | `kimi-code` (legacy: `kimi-cli` / `kimi`) | Moonshot coding agent. |
| Codex CLI | `codex` | OpenAI coding agent; `openai` aliases to `codex`. |
| Antigravity | `agy` | Google Antigravity agent; legacy `gemini` aliases to `agy`. |
| Pi | `pi` | The `deepseek` alias resolves to `pi`. |
| Reasonix | `reasonix` | DeepSeek-native coding agent; requires `DEEPSEEK_API_KEY`. |

Agent-specific behavior belongs in one profile, not in downstream runner gates:

1. Add the public registry entry in `packages/core/src/agent/specs.ts`.
2. Add or update the runner profile in `packages/cli/src/runner/agent-spawn.ts`.
3. Keep executor, attest, pairing, and scoring code agent-agnostic.
4. Add unit coverage for the profile and registry entry.

## Legacy Compatibility

Older projects may still contain `.roll/local.yaml agent`, `.roll/pairing.yaml`,
or v3 route slots in `.roll/agents.yaml`. `roll agent` shows them under
`Legacy compatibility`, and `roll agent migrate` converts their useful data into
the scoped model. They remain readable compatibility inputs, not the primary
agent-management model.

## See Also

- [configuration.md](configuration.md) — config and policy files
- [pairing.md](pairing.md) — evaluate-role review and scoring
- [loop.md](loop.md) — autonomous role resolution
