# Roll — Getting Started

This path gets one Roll-managed project from install to acceptance evidence in
about five minutes. Run it in a git repository.

## 1. Install

```bash
curl -fsSL https://seanyao.github.io/roll/install | bash
# or
npm install -g @seanyao/roll
```

Roll needs Node.js 22 or newer and at least one supported local AI agent.

## 2. Initialize The Project

```bash
cd your-project
roll setup
roll init
```

`roll init` creates the `.roll/` workspace and `AGENTS.md`. Existing codebases
may be routed into the legacy onboarding flow before files are written.

## 3. Add One Backlog Item

Add a small story card with one sentence:

```bash
roll idea "Add a health check endpoint"
```

`roll idea` auto-classifies, assigns an id, infers the epic, and creates the
card folder — you get both the backlog row and the story folder in one step.

Then edit `.roll/features/<epic>/<ID>/spec.md` so the ACs describe what
"done" means.

Keep the first story tiny: one visible behavior, one clear test path.

## 4. Start The Loop

```bash
roll loop on
roll loop status
```

`roll loop status` is the normal snapshot view. If a cycle is running and you
want the live terminal, attach to the tmux session that status reports:

```bash
tmux attach -t roll-loop-<project-slug>
```

For an immediate local cycle instead of waiting for the schedule:

```bash
roll loop now
```

## 5. Render Acceptance Evidence

After the story lands and the backlog row is `✅ Done`, render the offline
acceptance report:

```bash
roll attest US-DEMO-001
```

The report is written into that story folder under `.roll/features/`. Each AC
should have a verdict and evidence link before a release.
