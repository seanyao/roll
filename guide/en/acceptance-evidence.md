# Acceptance Evidence — `roll attest`

Every delivered story can carry a **single-file acceptance report**: per-AC
verdicts with the artifacts that back them, openable offline, printable to PDF,
readable by non-engineers.

## Where reports live

```
.roll/verification/<story-id>/<run-id>/report.html   ← the report (self-contained)
.roll/verification/<story-id>/<run-id>/evidence.json ← collected hard facts
.roll/verification/<story-id>/latest                 ← symlink to the newest run
```

Runs are timestamped and never overwritten. The backlog `✅ Done` row links to
`latest/report.html`; CHANGELOG bullets may carry an invisible
`<!-- evidence: ... -->` marker for traceability.

## How a report gets made

1. During the build/fix **Verification Gate**, the agent dumps raw outputs to
   `.roll/verification/<id>/evidence/*.txt` and screenshots to
   `…/screenshots/*.png` (web via Playwright, iOS via simctl, Android via adb —
   each surface skips cleanly when its tooling is absent; CLI stories capture
   ANSI text instead, rendered searchable in the report).
2. The agent writes `ac-map.json` — which evidence backs which AC, with a
   status per AC: `pass` · `readonly` · `partial` · `claimed` · `missing`.
3. `roll attest <story-id>` sweeps the hard facts (TCR commits, latest CI run,
   optional deploy probe, test-pass proof) and renders the report.

`roll attest` also runs standalone — without an intent map every AC renders as
🟧 Claimed, honestly.

## The red line

An AC with **zero evidence** can never claim `pass`: the renderer forces it
down to 🟧 Claimed and lists it under **Discrepancies**. Verbal completion
("I confirmed it works") is exactly what this rules out.

## Self-Score fold

When `.roll/notes/` carries same-story self-score entries, the report ends
with a collapsed *Self-Score · 自评* section. No entries → no section.
