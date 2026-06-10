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

## Self-Score fold

When `.roll/notes/` carries same-story self-score entries, the report ends
with a collapsed *Self-Score · 自评* section. No entries → no section.

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
.roll/features/index.html              ← front page: ledger (wish→truth bar),
                                         lifecycle spine, searchable epic cards
.roll/features/<epic>/index.html       ← epic page: epic ledger + stories in three
                                         groups (merged / in a cycle / in backlog)
.roll/features/<epic>/<id>/index.html  ← story dossier: five stations — Definition,
                                         Design, Execution, Delivery (attest banner
                                         + AC table), Retrospective
```

Every figure is computed from the real model — `spec.md`, `ac-map.json`, the
`latest/` pointer, self-score notes, `tcr:` commits — never typed in. The
guiding line: **backlog is wish, main is truth, done ≡ merged.**

**Freshness model (FIX-231):** the board keeps itself fresh — every
truth-changing node (`roll story new`, `roll attest`, `roll backlog
block/defer/unblock/promote`) refreshes the aggregate pages (front + epic) on
its own, best-effort, so a new card or status flip appears immediately. Story
pages stay *mount boards*: lifecycle nodes mount their facts in place and a
refresh never clobbers them. You only need `roll index` by hand for
reconciliation — `--rebuild` re-renders every story page from source (after
hand-merges or history migrations).
