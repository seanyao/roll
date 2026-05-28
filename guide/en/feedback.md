# roll feedback — one-shot CLI to GitHub Issues

`roll feedback` opens a GitHub issue directly from the project root so
you don't have to context-switch to the browser to file a bug, idea, or
UX comment.

`roll feedback` 一句话开 GitHub issue，不用切浏览器。

## Quick start

```bash
roll feedback --type bug --title "Login fails on Safari" \
              --body "Repro: 1. ... 2. ..."
```

When `gh` is installed and authenticated, the command runs
`gh issue create` with the resolved repo, title, body, and labels.

When `gh` is missing, the command prints a pre-filled URL pointing at
`github.com/<owner>/<repo>/issues/new` with everything already in the
query string — open it in your browser to file the issue.

You can also force the URL-print path explicitly:

```bash
roll feedback --type idea --title "Add dark theme" \
              --body "..." --print-url
```

## Flags

| Flag             | Notes |
|------------------|-------|
| `--type`         | `bug` / `idea` / `ux`. Default: `bug`. Picks the label prefix (see below). |
| `--title`        | Required. Issue title. |
| `--body`         | Issue body. Empty is allowed — env info still attaches unless `--no-env`. |
| `--repo`         | `owner/repo` override. Otherwise follows the precedence chain below. |
| `--no-env`       | Skip the auto-attached **Environment** section. |
| `--print-url`    | Print the pre-filled URL instead of invoking `gh`. |
| `--help`         | Inline help. |

## Type → labels mapping (US-FB-004)

Labels are added so GitHub Actions / project boards can sort feedback
into the right Roll backlog flow:

| `--type` | Labels emitted |
|----------|----------------|
| `bug`    | `bug,FIX`      |
| `idea`   | `idea,enhancement,US` |
| `ux`     | `ux,enhancement` |

The `FIX` / `US` suffixes mirror Roll's backlog id prefixes, so when an
issue gets pulled back into BACKLOG it lines up automatically.

## Target repo precedence (US-FB-003)

`roll feedback` resolves the destination repo in this order — first
match wins:

1. `--repo owner/repo` flag (explicit, beats all)
2. `ROLL_FEEDBACK_REPO=owner/repo` env var (one-shot)
3. `.roll/local.yaml` field `feedback_repo: owner/repo` (project pin)
4. `~/.roll/config.yaml` field `feedback_repo: owner/repo` (global default)
5. Github origin-derived `owner/repo` from `git remote get-url origin`

Pin a feedback repo at the project level when your docs project should
file issues into the engine repo instead of itself:

```yaml
# .roll/local.yaml
feedback_repo: my-org/my-engine
```

## Environment section (US-FB-002)

By default, `roll feedback` appends an `### Environment` block to the
issue body:

```
### Environment
- roll version: 2026.529.1
- OS: Darwin 25.4.0 arm64
- shell: zsh
- current agent: pi
- language: en_US.UTF-8
- project: my-app
```

This makes triage faster without you having to remember which fields
to include. Pass `--no-env` when filing a feature request where the
env doesn't matter.
