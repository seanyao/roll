# 验收契约权属 / Acceptance Contract Ownership

> Category: process. The design-owned acceptance contract, the evidence taxonomy,
> and the honest ceiling of what the harness can guarantee. Companion to
> `docs/verification.md` (which specifies per-story AC + evidence shape).

## 1. 契约是设计层拥有的冻结产物 / The contract is a design-owned, frozen artifact

A story's **acceptance contract** is the set of things its delivery is judged
against: its **AC criteria** and its **evidence surface** (`deliverable_url` /
`deliverable_cmd` / physical screenshot / `screenshot_exempt`). Ownership is
strict and one-directional:

- **Designer owns it.** The contract is authored with the story and does not
  change during a build.
- **Builder only satisfies it.** The builder produces code + evidence to meet
  the contract; it never authors or edits the contract.
- **Evaluator only reads and judges it.** Attest reads the contract and decides
  Done; it never lets the builder's own edits redefine the bar.

**Enforced by topology, not per-agent tool permissions.** Roll runs a
heterogeneous agent fleet; there is no uniform per-agent write-lock. Instead the
contract is **frozen at cycle start** into a snapshot (a projection of the
evidence-surface frontmatter + the set of AC criteria texts, hashed), taken from
**design truth** — not the builder-writable worktree copy. The attest gate
judges against that frozen snapshot; a worktree spec whose contract projection
no longer matches the snapshot is **drift** and is surfaced as an alert. The
projection deliberately EXCLUDES completion claims (checkbox state, the `✅`
tick, the `**Status**` line, Delivery/narrative sections) so the ordinary
stale-claim reset is never mistaken for tampering.

**Ingest is shift-left and soft.** A story with an AC block must declare a
capture surface OR a `screenshot_exempt` reason. A card that declares neither is
recorded to a hold list and alerted at authoring time — never a hard block of
ingestion, and runtime `pick_story` is never blocked (a false positive must not
stall the loop).

**Exemptions are design-time and audited.** `screenshot_exempt` is part of the
frozen contract (a builder cannot introduce one that counts). "Exempt from
screenshot" is not "exempt from evidence": an exempt card still owes another
capturable evidence form (command output or named tests). The existing
exemption rate is an observability smell signal (surfaced overall + per epic);
legacy per-card exemptions and any policy epic-level blanket exempt
(`acceptance.screenshot_exempt_epics`) are auditable read-only for batch review,
forward-enforced and never retroactively blocked.

## 2. 证据分类 / Evidence taxonomy

Every AC-bearing story binds **at least one real, gate-resolvable capturable
evidence**. There is no "give nothing" path. Screenshot is one kind, not the
only kind:

| Surface | Capture | Bound by |
|---|---|---|
| Web page (`deliverable_url`) | headless screenshot | harness |
| CLI/terminal (`deliverable_cmd`, read-only roll command) | captured terminal output | harness |
| Physical desktop / real terminal | **roll-capture** (real screen pixels) | harness |
| Library / pure backend | named test-pass references | builder (non-captured) |

For **captured** artifacts (the first three), the harness — which knows what it
captured — is the intended owner of the ac-map binding, so the builder does not
type or confirm those paths; the builder's ac-map covers only **non-captured**
evidence (named tests, manual verification notes). "No screenshot" therefore
still requires a declared `deliverable_cmd` or named tests — not silence.

## 3. 能力天花板 / What this guarantees — and what it does not

These mechanisms guarantee, structurally:

- the contract cannot be silently tampered by the builder (frozen snapshot +
  drift detection);
- an AC-bearing card cannot enter the backlog with no declared way to produce
  evidence (shift-left ingest);
- captured evidence is bound to real on-disk artifacts, not invented paths.

They do **not** guarantee that the evidence CONTENT actually proves the AC. A
`deliverable_cmd: echo ok` or a vacuous test resolves as "evidence present" yet
demonstrates nothing. **Judging whether the evidence genuinely satisfies the
criterion is the Evaluator's semantic job** — read the content, score it — and
is out of scope for the existence/binding/ownership guarantees above. The
harness makes tampering hard and evidence necessarily present and correctly
bound; it does not replace the reviewer reading the proof.

## 4. 现状 / Implementation status (honest, not target-washed)

This model is delivered incrementally; the doc describes the intended contract,
and this section states what is LIVE vs DESIGNED so nothing above is read as
more-enforced than it is.

- **Live** (US-EVID-020/021/022): the contract PROJECTION + cycle-start frozen
  snapshot (`contract-projection.ts`, `contract-snapshot.ts`); the attest gate's
  worktree-vs-snapshot **drift alert** (`attest-gate.ts`, alert-only); the
  **shift-left ingest** surface check + hold list (`ingest-gate.ts`), phased and
  **default observe-only** (`metric`) — `alert`/`block` are opt-in via policy.
- **Live** (US-EVID-026/027): exemption-rate observability (`exemption-stats.ts`)
  and the read-only exemption audit (`exemption-audit.ts`).
- **Designed / in progress**: harness-owned binding of captured artifacts into
  the ac-map (US-EVID-023 — the read primitive exists; the draft-generator
  wiring + capture-failure surfacing are not yet wired); the confirmed-ac-map
  dangling-evidence remediation trigger (US-EVID-024); design-time hetero-
  consensus confirmation of exemptions + the enforced substitute-evidence
  requirement (US-EVID-025). Until those land, "no give-nothing path" and
  "harness owns the binding" are the DESIGN intent, not a runtime guarantee.
