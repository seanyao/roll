# Roll — Configuration

Roll resolves three environment variables at startup. Override any of them
before running `roll` to change where it looks for state, skills, and
shared conventions.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ROLL_HOME` | `~/.roll` | Per-user state root. Holds `config.yaml`, installed `skills/`, synced `conventions/`. |
| `ROLL_CONFIG` | `$ROLL_HOME/config.yaml` | Agent routing, active window, schedule, per-tool config. |
| `ROLL_GLOBAL` | `$ROLL_HOME/conventions/global` | Global convention files (`AGENTS.md`, `CLAUDE.md`, etc.) synced into AI tool directories. |

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
ROLL_CONFIG=/tmp/test-config.yaml roll agent use kimi
```

## Verifying

`roll status` prints the resolved paths so you can confirm overrides took
effect. `roll doctor` checks the directory structure under the resolved
`ROLL_HOME`.

## See Also

- [overview.md](overview.md) — three-layer model, BACKLOG priority
- [loop.md](loop.md) — `roll loop` subcommands
