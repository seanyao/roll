# Roll — Configuration

Roll resolves three environment variables at startup. Override any of them
before running `roll` to change where it looks for state, skills, and
shared conventions.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ROLL_HOME` | `~/.roll` | Per-user state root. Holds `config.yaml`, installed `skills/`, synced `conventions/`. |
| `ROLL_CONFIG` | `$ROLL_HOME/config.yaml` | Editor, loop/dream/brief schedule hours, and per-tool (`ai_*`) config. Agent routing is **not** here — it lives in per-project `.roll/agents.yaml` (see [ai-agents.md](ai-agents.md)). |
| `ROLL_GLOBAL` | `$ROLL_HOME/conventions/global` | Global convention files (`AGENTS.md`, `CLAUDE.md`, etc.) synced into AI tool directories. |
| `ROLL_HEARTBEAT_TIMEOUT` | `1800` (seconds) | How long without a heartbeat write before the loop runner treats an inner cycle as orphan and heals state. Raise it if your cycles can legitimately stay quiet longer than 30 minutes. |
| `ROLL_LOOP_FORCE` | unset | When set to any non-empty value, `roll loop` bypasses the active-window check and the pause file. `roll loop now` and `roll loop test` set this internally; export it manually only when you want a cron-scheduled run to ignore quiet hours. |
| `ROLL_LOOP_NO_HEAL` | `0` | Set to `1` to disable post-build CI self-heal and restore fail-fast behaviour. Useful for debugging or when you want to cap autonomous spend per cycle. |
| `ROLL_LOOP_HEAL_MAX` | `2` | Maximum number of CI self-heal attempts per story after the build commits land. Raise it for noisy CI environments; lower it to fail faster. |
| `ROLL_PR_MERGE_TIMEOUT` | `600` (seconds) | **Deprecated (US-AUTO-044).** The main loop no longer waits for merge, so this is unused; PR merging is now handled asynchronously by the dedicated PR Loop. |
| `ROLL_LOOP_NO_POPUP` | unset | When set to any non-empty value, the runner does **not** auto-spawn a macOS Terminal.app window running `tmux attach`. For tests and headless batch runs — the popup outlives the killed tmux session and clutters the desktop. |
| `ROLL_LOOP_GC_RETENTION_DAYS` | `30` | Override the GC retention period for `roll loop gc`. Takes precedence over `loop_gc.retention_days` in `.roll/local.yaml`. |
| `ROLL_FEED_BUDGET_BYTES` | `16384` | Byte budget for the context feed handed to the inner agent each cycle. Set it to a positive integer to dial the feed to the inner agent's capacity; non-numeric or non-positive values fall back to the default. |
| `ROLL_AGENT_NUDGE` | `1` (on) | The in-tier nudge that picks the best agent within the routed complexity tier from recent run history. Set to `0` (or `off`/`false`/`no`) to disable it; the tier itself is never changed either way. |

`ROLL_CONFIG` and `ROLL_GLOBAL` derive from `ROLL_HOME`, so usually you only
need to override `ROLL_HOME` to relocate everything together.

## Common Overrides

Pin roll's state to a project-local directory (useful for CI, tests, or
isolated experimentation):

```bash
export ROLL_HOME="$PWD/.roll-sandbox"
roll setup
roll loop now
```

Run roll against an alternate convention set without touching `~/.roll`:

```bash
ROLL_GLOBAL=/path/to/team-conventions roll init
```

Point `ROLL_CONFIG` at a one-off config file to test changes:

```bash
ROLL_CONFIG=/tmp/test-config.yaml roll status
```

## Verifying

`roll status` prints the resolved paths so you can confirm overrides took
effect. Invoke the `roll-doctor` skill (`$roll-doctor`) to diagnose
directory structure issues under the resolved `ROLL_HOME`.

## Agent Installation

- `roll agent use openai` dispatches to the Codex CLI. Install with:
  `npm install -g @openai/codex`
- `roll agent use antigravity` (aliases: `agy`, legacy `gemini`) dispatches to the
  Antigravity CLI. Install with: `npm install -g @antigravity/agy`
- See [ai-agents.md](ai-agents.md) for the full supported agent list.

## See Also

- [overview.md](overview.md) — three-layer model, BACKLOG priority
- [loop.md](loop.md) — `roll loop` subcommands
- [ai-agents.md](ai-agents.md) — supported AI agents
