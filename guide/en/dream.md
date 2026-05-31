# roll-.dream — Nightly Code Health Scanner

`roll-.dream` is a nightly skill that scans the codebase for architectural friction,
dead code, and technical debt. It runs automatically at 3am (via launchd, installed by
`roll loop on`) and deposits `REFACTOR-NNN` entries into `BACKLOG.md` for loop to execute.

## What Dream Does

Dream runs one full scan per night and produces two outputs:

1. **`.roll/dream/YYYY-MM-DD.md`** — detailed report in Chinese (one file per night)
2. **BACKLOG.md entries** — actionable `REFACTOR-NNN` items appended to the `## ♻️ Refactor` table

The report covers:

- Dead code and unused functions
- Duplicated logic across modules
- Module boundary violations (one concern leaking into another)
- Missing tests for shipped behavior
- Documentation coverage gaps (missing EN/ZH guides, stale references)

## How to Read Dream Logs

```bash
# See last 3 nights
ls -lt .roll/dream/ | head -4

# Read latest report
cat .roll/dream/$(ls -1t .roll/dream/ | head -1)
```

Each report section ends with a priority classification:

- **P0** — blocks other work, should be addressed this sprint
- **P1** — significant friction, address within 2 weeks
- **P2** — low severity, address when convenient

## REFACTOR Item Generation

When dream finds a concrete, actionable issue it appends a row to BACKLOG.md:

```markdown
| REFACTOR-005 | Extract _for_each_ai_tool() — 4 duplicate iteration loops | 📋 Todo |
```

Loop picks these up at normal priority (after FIX-XXX, alongside US-XXX).

Dream does **not** generate REFACTOR entries for:
- Issues that would take >1 day to fix (escalates as IDEA instead)
- Purely stylistic preferences
- Issues already in BACKLOG as US or FIX items

## Schedule Configuration

Dream runs at 3am by default. The recommended way to change the time is the
`roll config dream-time` facade — it writes both keys at once, no hand-editing yaml:
推荐用 `roll config dream-time` 改时间 —— 一条命令同时写两个 key，免手工编辑 yaml：

```bash
roll config dream-time 03:20   # sets loop_dream_hour + loop_dream_minute
```

`roll config` writes to the project's `.roll/local.yaml` by default (`--project`);
pass `--global` to write `~/.roll/config.yaml` instead:
`roll config` 默认写项目的 `.roll/local.yaml`（`--project`）；加 `--global` 改写 `~/.roll/config.yaml`：

```bash
roll config loop_dream_hour 3            # set a single key, project scope
roll config loop_dream_hour 3 --global   # set a single key, global scope
roll config loop_dream_hour              # print current value + source
roll config --list                       # list all loop/dream/brief schedule keys
```

The underlying keys (resolved here as `.roll/local.yaml`):
底层 key（这里以 `.roll/local.yaml` 为例）：

```yaml
loop_dream_hour: 3     # 0-23, default 3
loop_dream_minute: 12  # 0-59, omit to auto-derive
```

`roll config` reloads the schedule automatically, so a separate `roll loop on` is
not required after changing the time. `roll loop on` installs the dream plist
alongside the loop and brief plists.
改完时间 `roll config` 会自动重载调度，无需再跑 `roll loop on`。`roll loop on`
会把 dream plist 和 loop、brief plist 一起安装。
All three services are managed together:

```bash
roll loop on       # install loop + dream + brief
roll loop status   # shows all three service states
roll loop monitor  # live dashboard for all three
```

## Manual Run

To run a dream scan immediately (without waiting for the scheduled 3am run):

```bash
# Using Claude Code directly
$roll-.dream
```

Dream always writes to today's date file and always appends to BACKLOG.md —
running it twice in one day appends a second pass (safe but redundant).
