# Roll Project — Internal Conventions

> ⚠️ **This file is for developers working ON Roll itself.**
> The user-facing baseline — distributed via `roll sync` to `~/.codex/AGENTS.md`,
> `~/.kimi/AGENTS.md`, etc. — lives at [conventions/global/AGENTS.md](conventions/global/AGENTS.md).

> Focus on outcomes.

## 1. Communication
- Respond in user's language. Code/Git/Comments: English. UI: Chinese.
- Concise. No summaries/code-walking. Implementation invisible.
- Strategy (Why) OK; Tactics (How) NO. Outcomes only.

## 2. Standards
- **TS**: Strict, no `any`. Functional hooks.
- **Rules**: [engineering-common-sense.md](docs/practices/engineering-common-sense.md).
- **Test**: Unit >80%, E2E for flows. Test before push.

## 3. Workflow
- **TCR**: Test -> Green = Commit / Red = Revert. No WIP.
- **Backlog**: Work stems from `BACKLOG.md`.
- **Docs**: [skill-selection-guide.md](docs/skill-selection-guide.md), [methodology.md](docs/methodology.md).

## 4. CLI
- **Entry**: `src/index.ts`, `commands/` per file.
- **UI**: Human default, `--json` support.
- **Config**: Flags > Env > File > Defaults.
