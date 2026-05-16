# Project Conventions — Backend Service

> Reference for skills to infer backend project conventions.
>
> **Foundation**: extends the shared rules in `~/.<agent>/AGENTS.md`
> (installed by `roll setup`). For BACKLOG row format, identity, TCR
> rhythm, and other cross-project rules, see that file's §4. Only
> project-specific stack / structure / domain rules live below.

## 1. Design
- **API**: RESTful `/api/{res}/{id}`. Structured JSON errors.
- **Config**: `.env` (validate at start). Flags > Env > File.
- **Logging**: Structured JSON (pino/winston). No secrets/PII.

## 2. Architecture
- **DDD**: Organize by business domain, not tech layer.
- **Clean**: Routes (thin) -> Services (logic) -> Models (data).
- **Database**: Migrations mandatory. Transactions for multi-table.

## 3. Structure
```
src/
├── routes/       # thin handlers
├── services/     # business logic
├── models/       # schemas/entities
└── middleware/   # auth/log/error
```

## 4. Discipline
- **TCR**: Mandatory.
- **Security**: Input validation (zod), Rate limiting, Secrets rotation.
- **Workspace**: `BACKLOG.md` + `docs/features/`.

## 5. Where to Look
- **Domain model**: `docs/domain/context-map.md` — Bounded Contexts and relationships
- **Story details**: `docs/features/` — AC, implementation specs, dependencies
- **Design decisions**: `docs/domain/` — DDD models, architecture records
