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

The `AGENTS.md` navigation section maps concept names to file paths:

```markdown
## Where to Look

| Concept | Location |
|---------|----------|
| Domain model | `docs/domain/` |
| Feature specs | `docs/features/<name>.md` |
| User guides | `docs/guide/` |
| Test helpers | `tests/unit/helpers.bash` |
```

`$roll-design` maintains this table as new docs and directories are added.
Any agent entering the project can navigate to authoritative sources without
scanning the whole tree.

## Legacy Projects: `$roll-doc`

For projects with scattered docs and no `AGENTS.md`:

```bash
$roll-doc
```

`roll-doc` scans the codebase, infers the domain structure, and writes an
`AGENTS.md` with a populated navigation table. It also flags documentation
gaps (missing architecture docs, undocumented public APIs) for `$roll-build`
to fill.

## Global Conventions

Files in `~/.roll/conventions/global/` are synced into every AI tool's config
directory by `roll setup` and `roll sync`. Changes to global conventions
propagate to all projects on your next sync.

## See Also

- [project-setup.md](project-setup.md) — `roll init` creates AGENTS.md
- [overview.md](overview.md) — three-layer model (human / BACKLOG / autonomous)
