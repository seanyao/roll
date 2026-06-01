# Security Policy

## Supported versions

Roll ships from one active line. The version installed via
`curl -fsSL https://seanyao.github.io/roll/install | bash` or
`npm install -g @seanyao/roll` is the supported version; older tags do
not receive security patches.

## curl|bash trust boundary

Piping a remote script into `bash` carries inherent risk. Mitigations:

- **Pin the version.** Set `ROLL_VERSION` to a known tag so a compromised
  `latest` redirect can't inject code:
  ```bash
  curl -fsSL https://seanyao.github.io/roll/install | ROLL_VERSION=v2.601.1 bash
  ```
- **Inspect before running.** Download and review the script first:
  ```bash
  curl -fsSL https://seanyao.github.io/roll/install -o /tmp/roll-install
  less /tmp/roll-install     # review
  bash /tmp/roll-install     # run
  ```
- **Verify the source.** The script is served from `seanyao.github.io/roll`,
  which is deployed from `site/install` in this repository via GitHub Pages.
  The deploy workflow runs on push to `main` and the Pages build is visible
  at `https://github.com/seanyao/roll/actions/workflows/deploy-site.yml`.

## Reporting a vulnerability

Please report security issues privately, not through public GitHub Issues.

**Email:** sean.dlut@gmail.com

When reporting, include:

- A description of the issue.
- Steps to reproduce, ideally with a minimal example.
- The version of Roll (`roll version`) and OS where you observed it.
- Your assessment of impact if you have one.

You can expect:

- An acknowledgement within 3 business days.
- A coordinated timeline for a fix and disclosure once we agree on severity.
- Credit in the changelog if you'd like to be named.

## Scope

Roll is a developer CLI. Security-relevant areas include:

- Anything the CLI writes outside the project directory (`~/.roll/`, `~/.shared/roll/`, `~/.claude/`, `~/.codex/`, etc.).
- Command construction for `git`, `gh`, `tmux`, and subprocess invocations.
- Loop runner scripts and worktree isolation.

If you're unsure whether something is in scope, send the report anyway and we'll figure it out together.

## Out of scope

- Reports against features that require explicit user opt-in to dangerous behaviour (`--dangerously-skip-permissions` on Claude Code, etc.) when used as documented.
- Issues that require an attacker to already have local code execution on your machine.
