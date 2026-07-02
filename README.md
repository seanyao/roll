```
 ██████╗  ██████╗ ██╗     ██╗     
 ██╔══██╗██╔═══██╗██║     ██║     
 ██████╔╝██║   ██║██║     ██║     
 ██╔══██╗██║   ██║██║     ██║     
 ██║  ██║╚██████╔╝███████╗███████╗
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

**[中文版 README](README_CN.md)**

[![Website](https://img.shields.io/badge/Website-seanyao.github.io%2Froll-blue)](https://seanyao.github.io/roll/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@seanyao/roll.svg)](https://www.npmjs.com/package/@seanyao/roll)
[![CI](https://github.com/seanyao/roll/actions/workflows/ci.yml/badge.svg)](https://github.com/seanyao/roll/actions/workflows/ci.yml)

Roll — a Prime Agent-led CLI harness that routes AI agents through story-scoped planning, building, evaluation, git, CI, and acceptance evidence. Works with Claude, Cursor, Codex, Kimi, Pi, Reasonix, and other local rigs when they are available.

## Install

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
```

```bash
npm install -g @seanyao/roll
```

Requirements: Node.js ≥ 22. Roll is a self-contained TypeScript CLI — no runtime engine beyond node.

## Use

```bash
cd your-project
roll init           # set up Roll here (interactive confirmation)
roll next           # continue with design, apply, repair, migrate, loop, or status
roll loop on        # let AI work through the backlog (optional)
```

`roll init` first diagnoses the current directory. Complete Roll projects get
`Already initialized` and `Next: roll status`; partial Roll projects get
`roll init --repair`, while pre-2.0 layouts get migration guidance without writing files. Existing codebases route to
`$roll-onboard`. PRD/docs-only workspaces are treated as new projects: Roll writes
`.roll/brief.md` from the detected document and points to
`roll design --from-file <detected-doc>`.
Empty directories ask what you are building in an interactive terminal; in scripts
and CI, plain `roll init` is read-only and `roll init --auto` writes a placeholder
brief before pointing to `roll design`.
For existing-codebase grafts, `roll init --apply` validates the generated
artifacts, prints a review checkpoint with every planned file operation, and
waits for owner confirmation before writing. Automation must use
`roll init --apply --auto` after that review.
After any init path, `roll next` is the continuation button: it reads the same
brief, onboard plan, backlog, and Roll markers, then prints one best next
command instead of a menu.
First time through? Start with [Getting started](guide/en/getting-started.md).

## V4 Prime Agent Execution

Roll V4 separates project coordination from story delivery:

- **Prime Agent** coordinates at project level: backlog order, cross-Story context, route advice, repeated failures, release readiness, budget, and owner escalation. It observes and advises; it does not implement a Story or override evidence gates.
- **Delta Unit** delivers one Story through scoped roles: `execute` performs the Story work, `evaluate` reviews/scores evidence, and `supervise` coordinates above the Story boundary.
- **supervise / execute / evaluate roles** are stable contracts. The concrete `agent` and optional `model` are resolved through the Agent Scope model: `Scope -> Role -> Binding -> Agent -> Model`.
- **Skills remain** the capability layer. Roles invoke `$roll-design`, `$roll-build`, `$roll-fix`, `$roll-peer`, `$roll-.qa`, and related skills instead of rewriting those contracts into TypeScript.
- **Fallback is fail-loud**. If a requested agent or rig is unavailable, Roll records that unavailability and pauses or asks for owner action; it does not silently pretend another agent was used.

### Prime Agent backlog-clearing standard

When the owner asks Roll to clear a backlog, Prime Agent treats the scope as every
live non-Hold `FIX-*`, `US-*`, and `REFACTOR-*` row unless the owner narrows it.
Before scheduling another card it reconciles backlog status, open PRs, recent
cycle endings, CI/evaluator gates, manual-merge PRs, and `.roll` meta state.
Each card gets its own Builder and, when required by the execution profile, an
independent Evaluator/Scorer selected from the current Agent roster. Repeated
failure, zero TCR, missing PR/CI/evaluator evidence, parser failures, auth
blocks, permission blocks, and `[roll:manual-merge]` PRs stop new scheduling and
surface an owner action through `roll supervisor status/next/why`.

### Operating modes

Roll has two product modes over the same backlog, truth, route profile, execution
profiles, evidence, Evaluator, and release gates:

- **guided** — the owner drives through `roll supervisor status/next/why` and
  starts work explicitly with commands such as `roll loop go --cards <id>`.
  Guided mode never silently starts long-running Story execution. When the
  scheduler is off, `roll loop go` runs a manual goal; when the loop is paused,
  use `roll loop resume` before scheduled work can continue.
- **autonomous** — `roll loop on` installs the scheduler; eligible Stories may
  be picked within the existing pause, budget, route, evidence, Evaluator, and
  release gates. `roll loop pause` / `roll loop off` return control to guided
  operation; `roll loop resume` / `roll loop on` switch back explicitly.
- **Attest and evidence are story-scoped**. A Story is accepted through its own `latest/<id>-report.html`, AC map, and screenshots/test artifacts.

Agent bindings are declared in two files: `~/.roll/agents.yaml` for Machine Scope
and `.roll/agents.yaml` for Project Scope. A Project can inherit the machine pool
and bind Story roles:

```yaml
schema: roll-agents/v1
scope: project
inherits: machine
defaults:
  story:
    roles:
      execute:
        kind: select
        from: [kimi, codex, pi]
        require: [execute]
        strategy: first-available
      evaluate:
        kind: select
        from: [claude, codex, kimi, pi, agy, reasonix, cursor]
        require: [evaluate]
        avoid: [execute]
        strategy: least-recent
```

Runtime availability is explicit: if a candidate is not callable on the current
machine because of auth, network, VPN, or account state, the current resolution
records that limitation instead of rewriting the static pool.

## Onboarding Samples

**Zero-start project**

```bash
mkdir my-product && cd my-product
roll init
# In an interactive terminal, describe the requirement, point to a PRD,
# or let Roll write .roll/brief.md from detected notes.
roll next
roll design --from-file .roll/brief.md
roll loop on
```

Roll explains the next design step instead of inventing fake work. The Prime Agent turns the requirement into Stories, resolves `execute` and optional `evaluate` roles per Story, and the owner reviews story-scoped attest evidence.

**Existing project**

```bash
cd existing-codebase
roll init
roll next
roll init --apply        # after reviewing the generated onboard plan
roll loop on
```

Roll diagnoses the repository without destructive migration, writes or updates Roll metadata only after review, and then lets the Prime Agent reason over existing backlog, docs, context, open PRs, and scoped role bindings. Current state is visible through CLI-first observability: `roll status`, `roll loop watch`, `roll loop runs`, `roll loop cycle <id>`, `roll loop alert`, and story reports.

## Quick start for new projects

A new project needs a remote before the loop can push branches and open PRs:

```bash
cd your-project
roll init
# 1. Create a GitHub repository for the project and add it as `origin`
# 2. Push the current branch so the loop has somewhere to land work
git push -u origin main
# 3. Start the autonomous loop
roll loop on
```

The loop will fail fast with an alert if the repository is missing or
unreachable, so it never burns agent tokens against a broken push target.  If
you need to stop the loop, `roll loop pause` persists a pause marker; resume
with `roll loop resume` when ready.

## Commands

| Command | Description |
|---------|-------------|
| `roll agent [migrate\|list\|cast]` | Agent Scope, installed-agent inventory, and role casting |
| `roll backlog [sync\|block\|defer\|lint\|…]` | View, manage, lint, and sync pending tasks |
| `roll config [lang\|prices\|tune\|…]` | Read/write configuration, model prices, and suggest-only tuning |
| `roll design [--from-file <path>] [--agent <name>]` | Launch `$roll-design` interactively |
| `roll doctor [skills\|tools\|language]` | Diagnose install health, skills, tools, permissions, and language drift |
| `roll help [--lang en\|zh] [name]` | View built-in Charter / guide docs; `roll --help` prints CLI usage |
| `roll idea "<one-sentence description>"` | Capture and classify a new backlog card |
| `roll init` | Diagnose this directory and route setup/onboarding |
| `roll loop <on\|off\|go\|watch\|runs\|cycles\|cycle\|alert\|…>` | Run, observe, and maintain the autonomous executor |
| `roll next` | Continue init/onboard with one best next command |
| `roll release [--dry-run\|--showcase]` | Release planning/flow plus golden-path showcase support |
| `roll setup [skills\|offboard\|-f]` | Install/sync conventions or remove Roll-owned project artifacts |
| `roll status [ci\|pulse] [--json]` | Project health, CI state, and delivery pulse |
| `roll test [--where] [--reset]` | Run tests through the isolation adapter |
| `roll update` | Upgrade the global Roll install and re-sync conventions |
| `roll --version` / `roll -v` | Print installed roll version |

Retained support surfaces live under their owners: `roll config prices`, `roll config tune`,
`roll agent cast`, `roll doctor tools`, `roll status ci`, `roll status pulse`,
`roll loop cycles`, `roll loop cycle`, `roll release showcase`, and `roll setup offboard`.
Historical top-level aliases for those capabilities now return the standard
unknown-command response.

## Observability Now

Roll's current observability is CLI-first. Persistent facts flow through one
read path: anchors -> selectors -> adapter -> projections. `roll status`,
`roll loop watch`, `roll loop runs`, `roll loop cycle <id>`, `roll status pulse`, and
story-scoped attest reports are the current user-facing truth surfaces.
Role and collaboration visibility are part of that same surface: `roll loop cycle <id> --roles`,
`roll loop cycle <id> --collab`, `roll loop cycle --legend`, `roll supervisor live --collab`,
and the Execution Cast report block expose selected/returned/accepted role outcomes.
The archive rebuild is an on-demand archive and repair renderer for static HTML pages;
it is not the active delivery truth surface.

- A backlog row is a claim; merge evidence on `main` and recorded acceptance
  evidence are truth. A premature `✅ Done` claim is shown as drift.
- Cycle history is read through the TerminalOutcome vocabulary, not legacy
  free-form summary text.
- Missing facts render as `?`. A visible `0` means a known zero, not unknown.

`roll supervisor live` is the shipped CLI-first multi-role board. A browser/TUI
Prime Agent Live Console remains future work and must reuse the same view model.

## Repository layout

Dev side — a pnpm monorepo. Publish side — one npm package.

```
packages/      TypeScript engine (pnpm workspaces): spec · core · infra · cli · web
lib/           Runtime companions (prices snapshots, i18n catalog)
skills/        Git submodule → seanyao/roll-skills (the agent skill contracts)
conventions/   Conventions synced into AI clients by `roll setup`
template/      Project scaffolding installed by `roll init`
```

Build & test: `pnpm install && pnpm -r test`.

Published as a single npm package `@seanyao/roll`: `dist/` (the CLI bundled to one self-contained ESM by esbuild) + `lib/` + `skills/` + `conventions/` + `template/`.

## Documentation

| | |
|---|---|
| **Start here** | [Getting started](guide/en/getting-started.md) · [Overview & architecture](guide/en/overview.md) · [Engineering methodology](guide/en/methodology.md) |
| **Daily driving** | [The loop (autonomous executor)](guide/en/loop.md) · [Tools & policy](guide/en/tools.md) · [Configuration](guide/en/configuration.md) · [Pricing & cost](guide/en/pricing.md) · [FAQ](guide/en/faq.md) |
| **Quality machinery** | [Acceptance evidence (`roll attest`)](guide/en/acceptance-evidence.md) · [Evidence lifecycle](guide/en/acceptance-evidence.md#lifecycle-in-three-stages) · [Consistency & release gate](guide/en/consistency.md) · [Cross-agent pairing](guide/en/pairing.md) · [Peer review](guide/en/peer.md) · [Test isolation](guide/en/test-isolation.md) |
| **Under the hood** | [Architecture: layers · domain · invariants](docs/architecture.md) · [Verification system](docs/verification.md) · [Manifesto](docs/manifesto.md) |

Full guide index: [guide/en/](guide/en/) — agents, peer review, feedback, backlog sync, adoption patterns, and more.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, test setup, and PR conventions.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately, not through public issues.

## License

[MIT](LICENSE)
