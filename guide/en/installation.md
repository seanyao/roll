# Roll — Installation & Updates

## Install

### curl (recommended)

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

No prerequisites beyond bash 3.2+, curl, and tar — all preinstalled on macOS and Linux.

To pin a specific version:

```bash
curl -fsSL https://seanyao.github.io/roll/install | ROLL_VERSION=v3.610.1 bash
```

### npm

```bash
npm install -g @seanyao/roll
```

Requires Node.js 16+.

After installation via either method, run setup to sync conventions and skills into your AI tools:

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
| curl (default) | Re-downloads the latest tarball, extracts atomically, then `roll sync` |
| npm | `npm update -g @seanyao/roll`, then `roll sync` |
| git clone (contributors) | `git pull` in the package directory, then `roll sync` |

## Automatic Version Nudge

After each `roll` command, a background check queries the GitHub releases API
(at most once per 24 h, cached at `~/.roll/.update-check`). If a newer version
is available, a one-line nudge appears at the end of the next command's output.
The check is fire-and-forget — it never delays your command.

## Uninstall

### curl

```bash
rm -rf ~/.local/share/roll ~/.local/bin/roll
```

### npm

```bash
npm uninstall -g @seanyao/roll
```

Remove state files afterward if you no longer need them:

```bash
rm -rf ~/.roll ~/.shared/roll
```

## See Also

- [overview.md](overview.md) — what roll is
- [project-setup.md](project-setup.md) — `roll init` for a new project
- [configuration.md](configuration.md) — environment variables
- [SECURITY.md](../../SECURITY.md) — curl|bash trust boundary and version pinning
