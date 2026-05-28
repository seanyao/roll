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
npm test              # full bats suite (pre-push / CI / release)
bash tests/run.sh tests/unit/<file>.bats   # one file
bash tests/run.sh --affected              # TCR micro-step: only run tests touched by current diff
bash tests/run.sh --affected --dry-run    # preview what --affected would pick
```

- Unit tests live in `tests/unit/`, integration in `tests/integration/`.
- Use the helpers in `tests/helpers.bash` (`unit_setup`, `unit_setup_cd`, etc.) so cleanup is automatic.
- When you change behaviour, add or update tests in the same PR. CI-only fixes are fine, but a PR that adds code without exercising it gets a review request.

### Test quality gate (US-QA-012/013)

After CI goes green and before auto-merge, loop scans **changed bats files**
with `roll loop test-quality-check` for two **blocking** rubric categories:

After CI goes green and before auto-merge, loop runs the test-quality gate.

- **❼ Inline external-tool behaviour** — `sed` substitution, `awk` scripts,
  `grep -o` / `-oE`, `find -name`, `cut -f`, `tr -d` chained inside test
  bodies that re-implement what a project helper already does.
- **❽ Paths outside this repo** — `~/.codex`, `~/.kimi`, `~/.roll/`,
  `/etc/...` references in test assertions. Use `$BATS_TMPDIR` to sandbox.

If the gate finds violations:
- the PR's auto-merge is held
- `~/.shared/roll/loop/ALERT-<slug>.md` gets a structured entry with the
  file/line/category report
- you can fix the test, or bypass with `[skip-test-quality]` in the PR
  description (use sparingly — bypasses still ship and the violation goes
  to dream's REFACTOR queue).

PR 描述加上 `[skip-test-quality]` 可绕过这道门（请只在确实属于 false
positive 的场景使用）。规则定义见 [guide/en/testing/quality-rubric.md](guide/en/testing/quality-rubric.md)。

Lines with `# test-quality:allow` comment are skipped (escape hatch for
doc-validation tests that legitimately inline `awk` to parse markdown
without touching production code).

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
