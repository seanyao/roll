# Roll — Domain Context Map

> Engineering-layer documentation. Extracted from `bin/roll` and `skills/`. English only.

Roll is organized into five Bounded Contexts. Each context owns its language,
data, and behavior. Cross-context communication happens through well-defined
integration points annotated below.

---

## Bounded Contexts

### 1. Convention Management

**Responsibility**: Stores and distributes the engineering rules that govern how
all other contexts behave. Owns AGENTS.md, conventions/, templates, BACKLOG.md
structure, and per-project configuration.

**Key concepts**: Convention file, Project context, BACKLOG item, Configuration key.

**Core data**: `conventions/global/`, `template/`, `.roll.yaml`, `~/.roll/config.yaml`

---

### 2. Skill Delivery

**Responsibility**: Defines, routes, and executes skills. A skill is a
markdown-encoded workflow (SKILL.md) executed by an AI agent. This context owns
the agent routing layer, skill invocation, and the TCR execution contract.

**Key concepts**: Skill, Agent, TCR cycle, Micro-commit, Executor.

**Core data**: `skills/*/SKILL.md`, `~/.claude/skills/`, `_agent_run_skill()`,
`_project_agent()`, `_skill_content()`

---

### 3. Autonomous Operation

**Responsibility**: Schedules and drives automated execution of BACKLOG items
without human involvement. Owns the Loop executor, Dream nightly scanner, and
Peer cross-agent review gate.

**Key concepts**: Loop cycle, Active window, LOCK, Story state machine
(📋 Todo → 🔨 In Progress → ✅ Done), Dream scan, Peer session, ALERT.

**Core data**: `~/.shared/roll/loop/state.yaml`, `~/.shared/roll/loop/ALERT.md`,
`BACKLOG.md` status column, launchd plists, tmux session.

---

### 4. Observability

**Responsibility**: Makes automated activity visible to humans. Owns the Brief
digest, run history (runs.jsonl), ALERT surface, and loop monitor.

**Key concepts**: Brief, Run record, ALERT entry, Loop monitor.

**Core data**: `~/.shared/roll/loop/runs.jsonl`, `docs/briefs/`, `~/.shared/roll/loop/ALERT.md`,
`~/.shared/roll/dream/`, `~/.shared/roll/brief/`

---

### 5. Distribution

**Responsibility**: Packages, installs, and updates Roll itself. Owns the npm
package lifecycle, `install.sh`, `roll setup`, and `roll update`.

**Key concepts**: Package version, Sync, Installation path, Roll home.

**Core data**: `package.json`, `bin/roll`, `ROLL_PKG_DIR`, `ROLL_HOME` (`~/.roll`),
`install.sh`, `uninstall.sh`

---

## Context Map

```
                    ┌─────────────────────────────────┐
                    │     Convention Management        │
                    │  AGENTS.md / templates / config  │
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │ D                  │ D                  │ D
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  Skill Delivery  │  │   Autonomous     │  │  Distribution    │
   │  skills/*/SKILL  │  │   Operation      │  │  npm / setup     │
   │  agent routing   │  │  loop/dream/peer │  │  install / update│
   └──────────────────┘  └────────┬─────────┘  └──────────────────┘
              ▲                   │
              │ U (invokes)       │ publishes events
              │                   ▼
              └──────── ┌──────────────────┐
                        │  Observability   │
                        │ brief / runs /   │
                        │  ALERT / monitor │
                        └──────────────────┘
```

### Relationship Annotations

| Upstream (U) | Downstream (D) | Type | Integration Point |
|---|---|---|---|
| Convention Management | Skill Delivery | U → D | Skills read AGENTS.md + conventions via `_skill_content()`. **ACL**: `_skill_content()` insulates Skill Delivery from convention file layout changes. |
| Convention Management | Autonomous Operation | U → D | Loop reads BACKLOG.md, `~/.roll/config.yaml`, project slug. **ACL**: `_config_read_int/string()` and `_project_slug()`. |
| Convention Management | Distribution | U → D | `roll setup` syncs conventions from package dir to `~/.claude`. **PL**: file path convention (`conventions/global/`, `skills/`). |
| Skill Delivery | Autonomous Operation | U → D | Loop/dream invoke skills via `_agent_run_skill()`. **PL**: skill file path + argument contract (`skills/<name>/SKILL.md`). |
| Autonomous Operation | Observability | U → D | Cycle completion writes to `runs.jsonl` + `state.yaml`; alerts write to `ALERT.md`. **ACL**: `runs.jsonl` schema contract (strict — see FIX-018). |

---

## Anti-Corruption Layers (ACL)

**`_skill_content()`** — Reads a skill's SKILL.md and injects project context.
Decouples Skill Delivery from how conventions are stored.

**`_config_read_int/string()`** — Reads `~/.roll/config.yaml` with a default
fallback. Decouples Autonomous Operation from config file format changes.

**`runs.jsonl` schema** — Strict JSON schema enforced by `_loop_write_runs_jsonl()`.
Acts as the Published Language between Autonomous Operation and Observability.
Version-pinned fields: `ts` (UTC Z), `status` enum, `built/skipped/alerts` arrays.

**`_project_slug()`** — Derives a stable short identifier from the project path.
Used as a namespace key across all shared state directories.

---

## Published Languages (PL)

**Skill invocation contract**: `_agent_run_skill <skill-path> [args]`
Any skill invocable by loop/dream via this interface.

**BACKLOG row format**: `| [ID](link) | description | status emoji |`
Shared between Convention Management (owns the file) and Autonomous Operation
(reads + updates the status column).

**`runs.jsonl` record**: `{ts, project, run_id, status, built[], skipped[], alerts[], tcr_count, duration_sec}`
Published by Autonomous Operation, consumed by Observability (`roll loop runs`).
