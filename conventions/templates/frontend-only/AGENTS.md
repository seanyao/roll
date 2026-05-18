# Project Conventions — Frontend Only

> Reference for skills to infer frontend project conventions.
>
> **Foundation**: extends the shared rules in `~/.<agent>/AGENTS.md`
> (installed by `roll setup`). For BACKLOG row format, identity, TCR
> rhythm, and other cross-project rules, see that file's §4. Only
> project-specific stack / structure / domain rules live below.

## 1. Stack
- **Core**: React 18+ / TS / Vite / Tailwind / shadcn/ui.
- **State**: React state (simple), Zustand/Jotai (complex), TanStack Query (server).
- **Structure**: `src/domains/{domain}/` for DDD.

## 2. Architecture
- **DDD**: Logic in hooks/services, not components.
- **Decoupling**: UI renders only, logic in hooks.
- **Data**: Define schemas before logic.

## 3. Structure
```
src/
├── components/ui/   # shadcn (don't edit)
├── domains/         # DDD components/hooks/services
└── shared/          # api/types/utils
```

## 4. Discipline
- **TCR**: Mandatory.
- **Testing**: Unit (hooks/logic) >80%, E2E (Playwright).
- **Workspace**: `.roll/backlog.md` + `.roll/features/`.

## 5. Where to Look
- **Domain model**: `.roll/domain/context-map.md` — Bounded Contexts and relationships
- **Story details**: `.roll/features/` — AC, implementation specs, dependencies
- **Design decisions**: `.roll/domain/` — DDD models, architecture records
