# Project Preferences — CLI Tool (Gemini CLI)

> Extends global GEMINI.md + project AGENTS.md.

## Stack

- Bash CLI — single script at `bin/roll`. No Node runtime, no build step.
- Tests: `bats` (`tests/unit/`, `tests/integration/`, vendored at `tests/helpers/bats-core/`).
- npm is the **distribution channel only** (`@seanyao/roll`); install does not require Node at runtime.

## Gemini Notes

- No server, no frontend, no Node runtime. Single-file bash CLI.
- Test commands by running them, not just unit tests.
- Run `bash bin/roll --help` and `npm test` before pushing.
- Follow the project AGENTS.md for architecture constraints and Roll workflow.
