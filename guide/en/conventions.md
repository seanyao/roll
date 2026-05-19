# Roll — Conventions & AGENTS.md

Roll's convention system gives every AI agent the same shared understanding of
your project — its domain, coding standards, and navigation pointers.

## AGENTS.md

`AGENTS.md` is the primary convention file. It defines:

- **Domain model**: bounded contexts, aggregates, key entities
- **Coding standards**: language idioms, naming, forbidden patterns
- **Scope rules**: which files an agent is allowed to touch
- **Where to Look**: named pointers to key docs and directories
- **Goal-Driven Execution**: instructions for agents to define verifiable goals before acting

Roll writes an `AGENTS.md` skeleton during `roll init`. You fill in the domain
model and standards that are specific to your project.

## Goal-Driven Execution Rule

Every agent must define a verifiable goal before starting work:

```
Verifiable Goal: <one sentence that can be confirmed true or false>
Success Criteria: <measurable outcomes>
```

This prevents vague execution ("refactor the auth module") and forces the agent
to state what "done" looks like. Roll's skills enforce this at the start of each
story.

## Where to Look

The `AGENTS.md` navigation section maps concept names to file paths. Roll 2.0
consolidates everything Roll touches under `.roll/`, so navigation is anchored
there:

```markdown
## Where to Look

| Concept | Location |
|---------|----------|
| Backlog index | `.roll/backlog.md` |
| Feature specs | `.roll/features/<name>.md` |
| Domain model | `.roll/domain/context-map.md` |
| Architecture decisions | `.roll/decisions/` |
| Autonomous output (briefs, dream) | `.roll/briefs/`, `.roll/dream/` |
| User guides | `guide/en/`, `guide/zh/` |
| Test helpers | `tests/unit/helpers.bash` |
```

The contract: `AGENTS.md` lives at the project root (every AI client reads it
first); everything it points into lives under `.roll/`. The root stays clean,
and the navigation table is the single map agents need.

`$roll-design` maintains this table as new docs and directories are added.
Any agent entering the project can navigate to authoritative sources without
scanning the whole tree.

## Legacy Projects: `$roll-onboard` and `$roll-doc`

For an existing codebase with no `.roll/` yet, the entry point is
`$roll-onboard` (the **graft** adoption pattern). It scans the code, asks a
focused set of cognition / scope / privacy questions, and writes
`.roll/onboard-plan.yaml` as a reviewable contract. `roll init --apply` then
turns that plan into the on-disk structure — see
[legacy-onboarding.md](legacy-onboarding.md) and
[patterns/](patterns/README.md).

For projects that already have `AGENTS.md` but scattered docs:

```bash
$roll-doc
```

`roll-doc` infers the domain structure from existing code, refreshes the
`Where to Look` navigation table, and flags documentation gaps (missing
architecture docs, undocumented public APIs) for `$roll-build` to fill.

## Global Conventions

Files in `~/.roll/conventions/global/` are synced into every AI tool's config
directory by `roll setup` and `roll sync`. Changes to global conventions
propagate to all projects on your next sync.

## See Also

- [project-setup.md](project-setup.md) — `roll init` creates AGENTS.md
- [overview.md](overview.md) — three-layer model (human / BACKLOG / autonomous)
