# Roll — Installation & Updates

## Install

```bash
npm install -g roll
```

After installation, run setup to sync conventions and skills into your AI tools:

```bash
roll setup
```

## Verify

```bash
roll --version   # print installed version
roll status      # show resolved paths and convention state
```

## Update

```bash
roll update
```

Roll detects how it was installed and acts accordingly:

| Install mode | What `roll update` does |
|---|---|
| npm (default) | `npm update -g roll`, then `roll sync` |
| git clone (contributors) | `git pull` in the package directory, then `roll sync` |

## Automatic Version Nudge

After each `roll` command, a background check queries the GitHub releases API
(at most once per 24 h, cached at `~/.roll/.update-check`). If a newer version
is available, a one-line nudge appears at the end of the next command's output.
The check is fire-and-forget — it never delays your command.

## Uninstall

```bash
npm uninstall -g roll
```

Remove state files afterward if you no longer need them:

```bash
rm -rf ~/.roll ~/.shared/roll
```

## See Also

- [overview.md](overview.md) — what roll is
- [project-setup.md](project-setup.md) — `roll init` for a new project
- [configuration.md](configuration.md) — environment variables
