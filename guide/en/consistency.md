# Consistency — `roll consistency check`

Six dimensions are continuously reconciled against truth anchors. A backlog
`✅ Done` row is a claim; merge evidence on `main`, acceptance reports, terminal
cycle events, and release-gate events are the facts. The dimensions are:
① code ↔ backlog claims · ② cards (every live backlog row owns
`features/<epic>/<ID>/spec.md`; evidence links never dangle; card-era delivered
stories with ACs own a `latest/<ID>-report.html`; pre-card-era Done rows are
counted, not failed) · ③ docs (changelog / features / guide / README / --help)
· ④ tests · ⑤ bilingual parity (guide en↔zh + i18n keys) · ⑥ site.

```bash
roll consistency check          # human-readable report
roll consistency check --json   # machine-readable; exit 0 = all pass
```

## The release gate

Every `v*` tag runs the **consistency gate** before the GitHub Release is
created: any failing dimension aborts the release, and the job log lists
exactly which gaps to close. Shipping with a known drift requires fixing the
drift — not skipping the gate.

The acceptance-evidence gate is `hard` by default. `loop_safety.attest_gate: soft`
is an explicit project policy for migration windows; consistency still reports
missing or dangling evidence so the gap cannot disappear silently.

## Doc alignment boundary

Registry drift is already a hard red line: if the command registry, README,
guide, or `--help` disagree, the FIX-242 guard fails consistency and release.
The `doc-gap` signal in `roll attest` is shadow-only. It warns when a delivery
diff changes user-visible command or output-copy files without a README/docs/guide/site
touch in the same diff, but it does not change the report exit code or Gate
verdict yet.
