# Consistency — `roll consistency check`

Five dimensions are continuously reconciled against the backlog's `✅ Done`
rows as the source of truth: ① code ↔ backlog · ② docs (changelog / features /
guide / README / --help) · ③ tests · ④ bilingual parity (guide en↔zh + i18n
keys) · ⑤ site.

```bash
roll consistency check          # human-readable report
roll consistency check --json   # machine-readable; exit 0 = all pass
```

## The release gate

Every `v*` tag runs the **consistency gate** before the GitHub Release is
created: any failing dimension aborts the release, and the job log lists
exactly which gaps to close. Shipping with a known drift requires fixing the
drift — not skipping the gate.
