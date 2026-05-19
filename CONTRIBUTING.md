# Contributing to Roll

Thanks for your interest. Roll is small enough that small focused PRs are the easiest to land — keep each change to one thing.

## Development setup

```bash
git clone https://github.com/seanyao/roll.git
cd roll
./install.sh
```

`install.sh` symlinks the dev tree into `~/.roll/`, so changes to `bin/roll` and `skills/` take effect immediately for any project on the same machine.

## Tests

All changes must keep CI green.

```bash
npm test              # full bats suite
bash tests/run.sh tests/unit/<file>.bats   # one file
```

- Unit tests live in `tests/unit/`, integration in `tests/integration/`.
- Use the helpers in `tests/helpers.bash` (`unit_setup`, `unit_setup_cd`, etc.) so cleanup is automatic.
- When you change behaviour, add or update tests in the same PR. CI-only fixes are fine, but a PR that adds code without exercising it gets a review request.

## PR conventions

- Title: `<type>: <description>` — `fix:` / `feat:` / `refactor:` / `docs:` / `chore:`. For story execution use `Story N: …`.
- Keep PRs small and reviewable. If you find yourself touching three different areas, that's three PRs.
- Reference the BACKLOG id (US-XXX / FIX-XXX / REFACTOR-XXX) in the title or body so the changelog can pick it up.
- Branch from `main` and rebase before requesting review.

## Backlog discipline

If you want to add a new Story, FIX, or REFACTOR, do it via:

```bash
roll idea "<one sentence describing what you want>"
```

Don't edit `.roll/backlog.md` by hand for new items — `roll idea` assigns the id and classifies the type. For descriptions, follow the convention in `conventions/global/AGENTS.md` §4: plain language, no file paths, no function names, no architecture jargon.

`roll backlog lint` (warn-only as of REFACTOR-041) flags violations for you.

## Reporting bugs

Use [GitHub Issues](https://github.com/seanyao/roll/issues) for bugs and feature requests. Please include:

- Your OS + `roll --version`.
- The exact commands you ran.
- The full output (redact anything sensitive).

For security-sensitive issues, see [SECURITY.md](SECURITY.md).
