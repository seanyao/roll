# Project Conventions — CLI Tool

> Reference for skills to infer CLI project conventions.
>
> **Foundation**: extends the shared rules in `~/.<agent>/AGENTS.md`
> (installed by `roll setup`). For BACKLOG row format, identity, TCR
> rhythm, and other cross-project rules, see that file's §4. Only
> project-specific stack / structure / domain rules live below.

## 1. Principles
- **Lightweight**: No server/frontend.
- **Commands**: `tool <cmd> [opts]`. One file per cmd in `src/commands/`.
- **Exit Codes**: 0 success, 1 user error, 2 system error.

## 2. Architecture
- **Entry**: `src/index.ts` bootstrap.
- **Config**: Flags > Env > File > Defaults.
- **Output**: Human-friendly default, `--json` support. Errors to stderr.

## 3. Structure
```
src/
├── index.ts      # bootstrap
├── commands/     # handlers
└── config.ts     # logic
tests/
├── unit/         # logic
└── integration/  # execa
```

## 4. Discipline
- **TCR**: Mandatory.
- **Distribution**: `bin` in `package.json`, test `npm i -g`.
- **Workspace**: `.roll/backlog.md` + `.roll/features/`.

## 5. Where to Look
- **Domain model**: `.roll/domain/context-map.md` — Bounded Contexts and relationships
- **Story details**: `.roll/features/` — AC, implementation specs, dependencies
- **Design decisions**: `.roll/domain/` — DDD models, architecture records
