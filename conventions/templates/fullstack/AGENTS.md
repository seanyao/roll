# Project Conventions — Fullstack Web

> Reference for skills to infer fullstack project conventions.
>
> **Foundation**: extends the shared rules in `~/.<agent>/AGENTS.md`
> (installed by `roll setup`). For BACKLOG row format, identity, TCR
> rhythm, and other cross-project rules, see that file's §4. Only
> project-specific stack / structure / domain rules live below.

## 1. Stack
- **Frontend**: React 18+ / TS / Vite / Tailwind / shadcn/ui.
- **Backend**: Node.js REST API.
- **Structure**: `src/domains/{domain}/` for DDD. `api/` for backend.

## 2. Architecture
- **DDD**: Logic in hooks/services, not components.
- **Contract**: API changes must sync `shared/types/`.
- **Data**: Define schemas before logic.

## 3. Structure
```
src/
├── components/ui/   # shadcn (don't edit)
├── domains/         # DDD components/hooks/services
└── shared/          # api/types/utils
api/
├── routes/          # thin handlers
└── services/        # business logic
```

## 4. Discipline
- **TCR**: Mandatory.
- **Testing**: Unit >80%, E2E for critical flows.
- **Workspace**: `.roll/backlog.md` + `.roll/features/`.

## 5. Where to Look
- **Domain model**: `.roll/domain/context-map.md` — Bounded Contexts and relationships
- **Story details**: `.roll/features/` — AC, implementation specs, dependencies
- **Design decisions**: `.roll/domain/` — DDD models, architecture records
