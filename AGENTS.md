# Roll Project — Internal Conventions

> ⚠️ **This file is for developers working ON Roll itself.**
> The user-facing baseline — distributed via `roll setup` to `~/.codex/AGENTS.md`,
> `~/.kimi/AGENTS.md`, etc. — lives at [conventions/global/AGENTS.md](conventions/global/AGENTS.md).

> Focus on outcomes.

## 1. Communication
- Respond in user's language. Code/Git/Comments: English. UI: Chinese.
- Concise. No summaries/code-walking. Implementation invisible.
- Strategy (Why) OK; Tactics (How) NO. Outcomes only.

## 2. Standards
- **Bash**: `set -euo pipefail`. All variables quoted. shellcheck-clean.
- **Rules**: [engineering-common-sense.md](docs/practices/engineering-common-sense.md).
- **Test**: bats coverage for `cmd_*` and helpers. Run `npm test` before push.

## 3. Workflow
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP.
- **Backlog**: Work stems from `BACKLOG.md`.
- **Docs**: [skill-selection-guide.md](docs/skill-selection-guide.md), [methodology.md](docs/methodology.md).

## 4. CLI
- **Entry**: `bin/roll` — single bash script. No Node runtime. No build step.
- **Tests**: `bats` (`tests/unit/`, `tests/integration/`).
- **Config**: Flags > Env (`ROLL_HOME`, `NO_COLOR`) > File (`~/.roll/config.yaml`) > Defaults.
- **UI**: Human-readable bilingual output (EN + ZH on separate lines).
