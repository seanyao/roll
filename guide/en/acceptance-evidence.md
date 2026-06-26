# Acceptance Evidence — `roll attest`

Every delivered story can carry a **single-file acceptance report**: per-AC
verdicts with the artifacts that back them, openable offline, printable to PDF,
readable by non-engineers.

## Where reports live

Every story has ONE home — its card folder under the epic:

```
.roll/features/<epic>/<id>/<run-id>/<id>-report.html  ← the report (self-contained)
.roll/features/<epic>/<id>/<run-id>/evidence.json     ← collected hard facts
.roll/features/<epic>/<id>/<run-id>/evidence/         ← raw command/test artifacts
.roll/features/<epic>/<id>/<run-id>/screenshots/      ← visual proof, when relevant
.roll/features/<epic>/<id>/ac-map.json                ← AC → evidence intent map
.roll/features/<epic>/<id>/latest                     ← symlink to the newest run
```

Runs are timestamped and never overwritten. The backlog `✅ Done` row links to
`latest/<id>-report.html`; CHANGELOG bullets may carry an invisible
`<!-- evidence: ... -->` marker for traceability.

## Lifecycle in three stages

1. Open the evidence frame. At the beginning of a loop cycle the runner creates
   the timestamped run directory and exports it to the inner agent as
   `ROLL_RUN_DIR`. The derived directories `ROLL_EVIDENCE_DIR` and
   `ROLL_SCREENSHOTS_DIR` point at `<run-id>/evidence/` and
   `<run-id>/screenshots/`.
2. Collect during execution. `roll test` writes command output and summaries
   into `ROLL_EVIDENCE_DIR`; visual lanes write screenshots into
   `ROLL_SCREENSHOTS_DIR` when the surface requires inspection. The agent keeps
   `ac-map.json` in the story card root, mapping each AC to the evidence files
   that support it, with a status per AC: `pass` · `readonly` · `partial` ·
   `claimed` · `missing`.
3. Close with the hard attest gate. The runner calls
   `roll attest <story-id> --run-dir "$ROLL_RUN_DIR"` at the end of delivery.
   `roll attest` sweeps the hard facts (TCR commits, latest CI run, optional
   deploy probe, test-pass proof), renders the report, moves `latest` to the
   run, refreshes the story delivery section when a dossier page exists, and
   refreshes `.roll/index.json`.

`roll attest` also runs standalone — without an intent map every AC renders as
🟧 Claimed, honestly.

## Gate policy

The attest gate is **hard by default**. A delivered story with ACs but no fresh,
contentful report is blocked rather than marked `✅ Done`. During an explicit
migration window a project may set `.roll/policy.yaml` to soft mode:

```yaml
loop_safety:
  attest_gate: soft
```

Soft mode records the gap and raises the same audit signal, but it does not
block the delivery cycle. Treat it as temporary compatibility, not the default.

## The red line

An AC with **zero evidence** can never claim `pass`: the renderer forces it
down to 🟧 Claimed and lists it under **Discrepancies**. Verbal completion
("I confirmed it works") is exactly what this rules out.

## Declaring visual evidence at design time

`roll story validate` checks, at design time, that a spec is *born* with a
visual-evidence AC (and, for a web surface, a declared product page to capture).
Two rules decide what the validator recognises:

- **The `[visual-evidence]` marker is authoritative.** An AC item that opens with
  a literal `[visual-evidence]` marker *is* a visual-evidence AC — on its own, no
  matter what words follow. You do not need to also write "screenshot" / "截图":
  the marker is your explicit declaration. (Without the marker, the validator
  still recognises unambiguous nouns like `screenshot` / `截图` / `录屏`.)

  ```markdown
  - [ ] [visual-evidence] headless capture of the Now landing and each tab
  ```

- **The declared surface wins over AC text.** Once a spec has a visual-evidence
  AC, its surface is read from the frontmatter first:
  - a declared `deliverable_url:` (alias `screenshot_url:`) ⇒ **web** — the card
    has committed to a real product page, so it owes a web screenshot;
  - else a declared `deliverable_cmd:` ⇒ **terminal** — a CLI deliverable that
    rides the terminal-capture lane;
  - else the AC text decides (web / terminal / ambiguous).

  So a card that declares `deliverable_url: .roll/features/agents.html` is judged
  a **web** surface even when its AC prose mentions a `roll` command.

## External tool readiness

Visual evidence uses machine-level tools that are declared explicitly and probed
at startup:

- `macOS screencapture` — physical Terminal.app / browser-window screenshot
  capture. It is built into macOS, but Terminal.app, the stable roll capture
  host, must have Screen Recording permission. Missing permission means attest
  records an honest screenshot skip; headless, transcript-rendered, and HTML
  reproduction images do not count as screenshot evidence.
- `Playwright Chromium` — optional headless browser diagnostics for non-attest
  tool use. Install with `npx playwright install chromium`.

`roll doctor` always prints the current availability, permission state, impact,
and repair command for these tools. `roll init` and `roll loop go` run the same
probe at startup; in an interactive terminal they ask whether to install/open
the missing setup steps, and in automation they stay silent unless
`ROLL_EXTERNAL_TOOLS=yes` or `ROLL_EXTERNAL_TOOLS=no` is set. Choosing `no`
prints the evidence impact and continues without changing the machine.

The machine Agents page (`.roll/features/agents.html`) includes the same tool
status block so a dossier reviewer can see whether evidence capture depends on
machine setup rather than story code.

## Review Score fold

When `.roll/notes/` carries the story's Review Score entry, the report ends
with a collapsed *Review Score · 评审分* section. No entry → no section. The
Review Score is produced by a fresh-session peer Reviewer, never by the
building agent.

## Where cards come from — `roll idea`

Add a card with one natural-language sentence:

```bash
roll idea "Refund flow is broken for partial payments"
```

`roll idea` auto-classifies it (bug → FIX / feature → IDEA), assigns the
next id in that family, lint-checks the description, infers the right epic
folder, and mints the full card folder (spec.md + story page + index
refresh). All in one command.

For explicit control over id and epic, the internal `roll story new` is
available:

```bash
roll story new US-PAY-001 --title "Refund flow" --epic payments
# the ONE minting entry: card folder + backlog row + index refresh in one step.
# Batch minting: add --no-index per card, finish with a single `roll index`.
```

Both channels write the frontmatter'd `spec.md`, the story page skeleton,
and refresh `.roll/index.json`. They refuse to overwrite an existing card —
cards are born once, then evolved by hand. Skills never hand-create card
files; the `cards` consistency dimension fails the release gate on any
live backlog row without a card.

## The Delivery Dossier — `roll index`

`roll index` regenerates the whole archive as a browsable, three-layer
**Delivery Dossier** (every page a self-contained HTML file — bilingual,
theme-aware, printable):

```
.roll/features/index.html              ← front page: truth board (Story / Cycle /
                                         Release), truth strip, searchable epic cards
.roll/features/<epic>/index.html       ← epic page: epic ledger + stories in three
                                         groups (merged / in a cycle / in backlog)
.roll/features/<epic>/<id>/index.html  ← story dossier: five stations — Definition,
                                         Design, Execution, Delivery (attest banner
                                         + per-AC evidence blocks), Retrospective
```

Every figure is computed from the truth model — anchors -> selectors -> adapter
-> projections — never typed in. Story facts compare backlog claims with merge
and evidence truth; Cycle facts use TerminalOutcome records; Release facts use
the latest gate verdict and active waiver. The guiding line: **backlog is wish,
main is truth, done ≡ merged.**

The front-page truth board keeps unknown visible. `?` means the fact is absent
or outside the known schema; `0` means a known zero. A premature backlog
`✅ Done` row is treated as a claim that conflicts with truth and is rendered as
drift, not as delivered work.

On story dossier pages, screenshot evidence remains a thumbnail linked to the
full image. Text evidence such as Vitest output is read from the referenced
evidence file and shown inline under the AC in a folded, scrollable block; if
the file is missing or unreadable, the page shows an explicit unavailable state.

**Freshness model (FIX-231):** the board keeps itself fresh — every
truth-changing node (`roll story new`, `roll attest`, `roll backlog
block/defer/unblock/promote`) refreshes the aggregate pages (front + epic) on
its own, best-effort, so a new card or status flip appears immediately. Story
pages stay *mount boards*: lifecycle nodes mount their facts in place and a
refresh never clobbers them. You only need `roll index` by hand for
reconciliation — `--rebuild` re-renders every story page from source (after
hand-merges or history migrations).
