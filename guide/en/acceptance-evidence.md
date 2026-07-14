# Acceptance Review Page — `roll attest`

Every delivered story can carry a **single-file Acceptance Review Page**: per-AC
verdicts with the artifacts that back them, openable offline, printable to PDF,
readable by non-engineers.

## Where Review Pages live

Every story has ONE home — its card folder under the epic:

```
.roll/features/<epic>/<id>/<run-id>/<id>-review.html  ← Acceptance Review Page (self-contained)
.roll/features/<epic>/<id>/<run-id>/<id>-report.html  ← legacy report alias (one release cycle)
.roll/features/<epic>/<id>/<run-id>/evidence.json     ← collected hard facts
.roll/features/<epic>/<id>/<run-id>/evidence/         ← raw command/test artifacts
.roll/features/<epic>/<id>/<run-id>/screenshots/      ← visual proof, when relevant
.roll/features/<epic>/<id>/ac-map.json                ← AC → evidence intent map
.roll/features/<epic>/<id>/latest                     ← symlink to the newest run
```

Runs are timestamped and never overwritten. The backlog `✅ Done` row links to
`latest/<id>-review.html`; CHANGELOG bullets may carry an invisible
`<!-- evidence: ... -->` marker for traceability.

**The story's `latest/<id>-review.html` is the human acceptance entry.** A
story is accepted by opening its own Acceptance Review Page — not a global archive/index page.
`roll attest` is story-scoped: it writes only this story's Review Page, the legacy report alias, and the
`latest` pointer. It does not refresh any global archive, epic, or front-page
HTML. Those board pages, when you want them, are rendered on demand with
the archive rebuild; they are a convenience/archive view, not the delivery-truth surface.

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
   that support it, with a status per AC: `pass` · `pass-with-evidence` ·
   `readonly` · `partial` · `claimed` · `missing`.
3. Close with the hard attest gate. The runner calls
   `roll attest <story-id> --run-dir "$ROLL_RUN_DIR"` at the end of delivery.
   `roll attest` sweeps the hard facts (TCR commits, latest CI run, optional
   deploy probe, test-pass proof), renders the Acceptance Review Page, and moves `latest` to the
   run. That is all it writes — it is story-scoped. It does not mount a story
   archive delivery section, regenerate `.roll/index.json`, or refresh any global
   archive/epic/front page (run the archive rebuild on demand for those board pages).

`roll attest` also runs standalone — without an intent map every AC renders as
🟧 Claimed, honestly.

Captured artifacts render by their actual media type, not the capture lane that
produced them. Image files (`png`, `jpg`, `jpeg`, `webp`, or `gif`, including a
recognised image signature without an extension) render as images; text output
such as `.txt` or `.log` is escaped and shown inline in a readable `<pre>`
block. A terminal capture may therefore appear in either form.

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

The merge gate reads structured evidence, not prose. A delivery can be refused
when any of these facts are true:

- `attest render` exits non-zero;
- `ac-map.json` references a path that does not resolve under the story run or
  card archive, except allowed GitHub PR/commit/check URLs for this repository;
- an AC remains `claimed`, which means the Builder asserted completion without
  pass/fail evidence;
- an AC remains `needs-confirmation`, which means the harness draft still needs
  Builder review;
- a positive AC (`pass`, `pass-with-evidence`, `readonly`, or `partial`) has no
  real evidence reference;
- a non-exempt visual card has no captured screenshot or recorded machine
  capture skip;
- a declared `deliverable_url`, `deliverable_cmd`, or `physical_terminal`
  surface was not really captured;
- an AC is `fail`, which means a check ran and went red.

The PR body carries a `Roll-Evidence` trailer that points reviewers to the
story-scoped evidence. Treat that trailer as the entry point for human review:
open the Acceptance Review Page, then follow the AC map and referenced files.

Use the audit command before release or when a Done row looks suspicious:

```bash
roll attest audit
roll attest audit --json
```

It scans Done stories for missing reports, missing or empty `ac-map.json`,
dangling evidence references, and `evidence_debt` rows. A clean audit exits 0;
any issue exits 1 and lists the story IDs and missing references.

## The red line

An AC with **zero evidence** can never claim `pass` or `pass-with-evidence`: the
renderer forces it down to 🟧 Claimed and lists it under **Discrepancies**.
`pass-with-evidence` is a harness-confirmed status backed by strong on-disk
evidence; it is explicitly not the same as an agent-confirmed `pass`. Verbal
completion ("I confirmed it works") is exactly what this rules out.

## Declaring visual evidence at design time

`roll story validate` checks, at design time, that a spec is *born* with a
visual-evidence AC (and, for a web surface, a declared product page to capture).
If the spec has a visual-evidence AC but no declared surface
(`deliverable_url`, `deliverable_cmd`, `physical_terminal`, or
`screenshot_exempt`), validation prints a soft must-declare warning and still
exits 0. Runtime gates carry the same must-declare signal as a diagnostic only;
they do not block or mark the delivery skipped for that reason alone.
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
  - a declared `physical_terminal:` ⇒ **terminal** with a stricter contract — the
    report must contain a real macOS `Terminal.app` screenshot captured from
    screen pixels. Headless stdout, transcript-rendered images, and HTML replays
    are rejected for this contract. `roll attest` also asks the
    `physical.screenshot` provider for this evidence when available, copies the
    returned PNG into the story run, and shows the status chain
    `requested -> taken/skipped/failed/timeout -> attached/not-attached`;
  - else a declared `deliverable_cmd:` ⇒ **terminal** — a CLI deliverable that
    rides the terminal-capture lane;
  - else the AC text decides (web / terminal / ambiguous).

  So a card that declares `deliverable_url: .roll/features/agents.html` is judged
  a **web** surface even when its AC prose mentions a `roll` command.

## Evidence Modes

Stories may declare `evidence_mode:` in frontmatter, or an Evaluation contract
may declare `- evidence_mode: ...`. Roll also derives a mode for Evaluator
prompts, but only an explicit non-visual mode changes the screenshot gate.
That explicit mode is not a blank override: a declared URL, terminal command,
physical terminal, or visual-evidence AC still escalates to the relevant capture
gate.

| Mode | Required proof | Screenshot policy |
|------|----------------|-------------------|
| `visual_ui` | rendered visual capture, functional/smoke check, CI | required |
| `cli_output` | stdout/stderr snapshot, exit code, command fixture or focused test, CI | conditional; required for terminal/TUI visual changes |
| `refactor_contract` | focused tests, typecheck/build, grep/no-old-symbol checks, CI | not required unless visual risk is present |
| `data_state` | fixture replay, event assertions, idempotency/concurrency coverage, CI | not required unless visual risk is present |
| `docs_content` | rendered text checks, link checks, diff review, CI | conditional; required for layout changes |

`screenshot_exempt:` should name or imply the alternate matrix, preferably by
pairing it with `evidence_mode: refactor_contract`, `data_state`, or
`docs_content`. QA/Evaluator may escalate any non-visual mode back to a screenshot
gate when a visual surface changed, an AC explicitly asks for visual evidence, or
prior evidence exposes rendering/layout risk; the escalation reason must be
recorded.

## External tool readiness

Visual evidence uses machine-level tools that are declared explicitly and probed
at startup:

- `macOS screencapture` — physical Terminal.app / browser-window screenshot
  capture. It is built into macOS, but Terminal.app, the stable roll capture
  host, must have Screen Recording permission. Missing permission means attest
  records an honest screenshot skip; headless, transcript-rendered, and HTML
  reproduction images do not count as screenshot evidence. A successful
  interactive `Terminal.app` permission probe is cached under `ROLL_HOME` so
  repeated `roll doctor` / setup checks do not keep re-triggering the macOS
  prompt; if permission was just granted, restart Terminal.app before trusting
  the cache.
- `Roll Capture.app` / `physical.screenshot` — the provider path for physical
  screenshot requests. If readiness is unavailable, `roll attest` records an
  honest skip with the setup reason instead of blocking report generation; if
  the provider times out, the report surfaces timeout as its own failure reason.
  On macOS npm installs, Roll tries to install the app from the latest
  `seanyao/roll-capture` Release into `~/Applications`; `roll setup` can retry
  that repair unless `--no-capture-install` is set.

  **Capture default strategy (US-PHYSICAL-006):** Physical screenshot requests
  default to **window-level** capture — they only capture the tested application's
  window (Terminal.app for terminal/CLI evidence, Google Chrome for web evidence),
  not the full screen. Full-screen capture requires an explicit
  `capture_fullscreen: true` frontmatter declaration in the card spec. This
  privacy-first design prevents evidence chains from including irrelevant on-screen
  content (chat, email, other projects). If the target window is not found, Roll
  Capture.app returns a documented fallback with the reason recorded in the
  response and evidence ledger — no silent expansion of capture scope.
- `Playwright Chromium` — optional headless web capture for `roll attest` and
  archive screenshots. Install with `npx playwright install chromium`.

`roll doctor` always prints the current availability, permission state, impact,
and repair command for these tools. Use `roll doctor --tools` when you only want
the focused tool and Terminal.app Screen Recording readiness view. `roll init`
and `roll loop go` run the same probe at startup; in an interactive terminal they ask whether to install/open
the missing setup steps, and in automation they stay silent unless
`ROLL_EXTERNAL_TOOLS=yes` or `ROLL_EXTERNAL_TOOLS=no` is set. Choosing `no`
prints the evidence impact and continues without changing the machine.

The machine Agents page (`.roll/features/agents.html`) includes the same tool
status block so a reviewer can see whether evidence capture depends on
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
# Batch minting: add --no-index per card, finish with a single the archive rebuild.
```

Both channels write the frontmatter'd `spec.md`, the story page skeleton,
and refresh `.roll/index.json`. They refuse to overwrite an existing card —
cards are born once, then evolved by hand. Skills never hand-create card
files; the `cards` consistency dimension fails the release gate on any
live backlog row without a card.

## Static Archive — the archive rebuild

the archive rebuild is an on-demand repair/archive renderer. It regenerates browsable,
three-layer static HTML pages (every page is self-contained, localized with one
visible language at a time, theme-aware, printable):

```
.roll/features/index.html              ← archive front page (Story / Cycle /
                                         Release), truth strip, searchable epic cards
.roll/features/<epic>/index.html       ← epic page: epic ledger + stories in three
                                         groups (merged / in a cycle / in backlog)
.roll/features/<epic>/<id>/index.html  ← story archive: five stations — Definition,
                                         Design, Execution, Delivery (attest banner
                                         + per-AC evidence blocks), Retrospective
```

Every figure is computed from the truth model — anchors -> selectors -> adapter
-> projections — never typed in. Story facts compare backlog claims with merge
and evidence truth; Cycle facts use TerminalOutcome records; Release facts use
the latest gate verdict and active waiver. The guiding line: **backlog is wish,
main is truth, done ≡ merged.**

The archive front page keeps unknown visible. `?` means the fact is absent
or outside the known schema; `0` means a known zero. A premature backlog
`✅ Done` row is treated as a claim that conflicts with truth and is rendered as
drift, not as delivered work.

On story archive pages, screenshot evidence remains a thumbnail linked to the
full image. Text evidence such as Vitest output is read from the referenced
evidence file and shown inline under the AC in a folded, scrollable block; if
the file is missing or unreadable, the page shows an explicit unavailable state.

The current delivery truth remains story-scoped attest plus CLI-first
observability (`roll status`, `roll loop watch`, `roll loop runs`,
`roll loop cycle <id>`). Use the archive rebuild by hand for reconciliation, archive
export, CI artifacts, or migration repair; rebuild mode re-renders every story
page from source after hand-merges or history migrations.
