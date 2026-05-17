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
| `ROLL_HEARTBEAT_TIMEOUT` | `1800` (seconds) | How long without a heartbeat write before the loop runner treats an inner cycle as orphan and heals state. Raise it if your cycles can legitimately stay quiet longer than 30 minutes. |

`ROLL_CONFIG` and `ROLL_GLOBAL` derive from `ROLL_HOME`, so usually you only
need to override `ROLL_HOME` to relocate everything together.

## Advanced Variables

These are rarely overridden in normal use but appear throughout `bin/roll`.
Document them here so contributors and power users can find them without
reading the source.

| Variable | Default | Purpose |
|----------|---------|---------|
| `ROLL_TEMPLATES` | `$ROLL_HOME/conventions/templates` | Where project-type template files (`fullstack/`, `frontend-only/`, `backend-service/`, `cli/`) are synced to from the npm package. Override to point `roll init` at a custom template tree. |
| `ROLL_PKG_CONVENTIONS` | `$ROLL_PKG_DIR/conventions` | Source-of-truth convention files shipped inside the installed `roll` package. Override to test convention changes from a different source directory before publishing. |
| `ROLL_LOOP_FORCE` | unset | Internal flag set by `roll loop now` and `roll loop test` to bypass the active-window check and pause marker. Set it manually only when you need a one-off forced loop run from a script. |

### Internal State (not user-overridable)

`_ROLL_MERGE_SUMMARY` is a bash array used internally by `roll init` / `roll sync`
to accumulate per-file merge results (`created` / `merged` / `unchanged`) so the
final summary can be printed. The leading underscore marks it as private — do
not export or override it from outside `bin/roll`.

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
effect. Invoke the `roll-doctor` skill (`$roll-doctor`) to diagnose
directory structure issues under the resolved `ROLL_HOME`.

## See Also

- [overview.md](overview.md) — three-layer model, BACKLOG priority
- [loop.md](loop.md) — `roll loop` subcommands
