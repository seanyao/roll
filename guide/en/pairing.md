# Cross-Agent Pairing — heterogeneous second eyes, in the loop

Pairing makes a **different** agent (a different vendor) cross-check your work
automatically. The primitive is the **pair**, not the review: a working agent
delivers, and a heterogeneous peer reviews it for perspective diversity. A code
bug that one model's blind spot hides, another model's catches.

Roll treats reviewer assignment as the `evaluate` role in the scoped Agent
model: `Scope -> Role -> Binding -> Agent -> optional Model`. The agent is the
finite seven-name identity (`claude`, `kimi`, `codex`, `pi`, `agy`, `reasonix`, `cursor`);
the model is optional data carried by that agent.

Pairing is distinct from [`$roll-peer`](peer.md): peer is an on-demand,
multi-round negotiation you (or the loop's risk gate) trigger; pairing is an
always-available, one-way second pass wired into the cycle and governed by the
Project Scope `evaluate` binding.

## Turning it on — explicit, never silent

```bash
roll agent                         # inspect story.evaluate
roll agent migrate --dry-run       # preview one-time migration of old agent config
```

New projects should author the evaluator pool in `.roll/agents.yaml`:

```yaml
# .roll/agents.yaml
schema: roll-agents/v1
scope: project
defaults:
  story:
    roles:
      evaluate:
        kind: select
        from: [claude, codex, kimi, pi, agy, reasonix]
        require: [evaluate]
        strategy: health-aware
```

`.roll/pairing.yaml` is not a runtime input. The scoped `evaluate` role is the
only source for pairing candidates. Static config lists fair candidates; runtime
auth/network/VPN/account failures skip candidates only for the current resolution.

## Seeing what it does — observability

Loop cycle evidence and role views show the pool (who can pair, their vendor,
declared capability, and **why** an agent is excluded), plus **how much pairing
has cost**:

```
  Cross-Agent Pairing — pool status

  enabled: true · stages: [code]

    ✓ claude  vendor=anthropic · [code]
    ✓ codex   vendor=openai · [code]
    · pi      vendor=pi · [code] · excluded: no heterogeneous partner

  pairings to date: 7 (codex×4, kimi×3) · total cost $0.94 · 11 findings
```

Cost is recorded on every pairing from day one — you always know what the
second pair of eyes is spending, even without budget-adaptive throttling.

## How selection works

When a stage fires, the selector keeps **only** agents that are installed,
available, declared capable for that stage, able to run as a headless reviewer,
and a **different vendor** from the working agent — then rotates among them
(seeded by the cycle id, so it is replayable). Agents with a track record are
gently preferred (ε-greedy, ε≈0.2), but exploration is always preserved so no
single pair monopolizes. If no qualified heterogeneous peer exists, that absence
is itself recorded (`pair:none-available`) — never a silent skip.

## Safety — pairing never blocks a cycle

- **30s hard timeout** on the peer review (belt-and-braces in the executor), so
  a slow peer never stalls the cycle.
- **Non-blocking**: a timeout, error, or missing peer is recorded and the cycle
  proceeds. Pairing is an enhancement, never a gate.
- **Never touches main on its own**: pairing produces evidence and events, not
  merges.

## Events & evidence

Each pairing emits `pair:selected`, then `pair:verdict` (with the verdict,
findings count, cost, and stage) or `pair:none-available`. The verdict is also
written as evidence under the run's `peer/cycle-<id>.pair.json`. A score
pairing emits `pair:score` (score, verdict, cost) and writes
`peer/cycle-<id>.score.pair.json`.

## Stages

`code` and `score` are the defaults — a heterogeneous peer reviews the
delivered diff, and another scores the finished cycle. `design`, `test`, and
`cycle` extend the same mechanism to other checkpoints; enable them in
`stages` when you want earlier or broader second eyes.

## Review Score — a peer grades the cycle, never the author

An agent grading its own delivery is a conflict of interest, so the cycle's
quality score — the **Review Score** — is always produced by a Reviewer in a
**fresh, separate session**, never by the building agent (the agent does NOT
self-score):

- **In the loop**: after the acceptance gate passes, the runner casts a
  fresh-session Reviewer to score the delivery. The note lands in the card's
  `notes/` with provenance — `scoring: pair`, `scored-by: <agent>`, and the
  fresh-session id (so independence is verifiable).
- **Loop delivery**: after the acceptance gate passes, the runner triggers the
  same adapter from a fresh session.
- **Design output** (`roll-design`, no loop cycle): the design workflow can
  trigger a fresh-session Reviewer to grade the **design** (INVEST split,
  visual-AC completeness, `deliverable_url` correctness, domain/spec
  consistency) — not code. It stamps the score `stage=design`. The designing
  agent triggers but never grades its own work; no peer available → honest
  unscored (fail-loud), never a self-grade.
- **The builder's own agent never scores its own cycle when an independent peer
  exists**: whenever any other agent is installed, the builder is excluded from
  the score pool entirely — an independent Evaluator grades the delivery or the
  cycle fails loud (no self-score fallback, even from a fresh same-vendor
  session). The builder's own agent is the scorer **only** in a true
  single-agent install, where a fresh same-vendor session is the minimum
  acceptable independence. Independence is still verified by session id (a
  different `agent × model × session` rig is encouraged), so the single-agent
  case never deadlocks.
  A score sharing the builder's session — including any sub-agent of it — is
  rejected as a self-score. No independent candidate, a timeout, or a
  protocol miss does **not** fall back to a self-score; the absence is audited
  via a `pair:none-available` event and the story owes a fresh-session Review
  Score before it can attest (`review_score_missing`).
- **Real agent output is normalized before scoring**: an Evaluator's reply is
  accepted even when its stdout carries terminal control bytes, ANSI startup
  banners, a JSONL stream-json wrapper, or a bullet/markdown prefix — the parser
  normalizes these away, then still requires one complete, in-order
  `SCORE`/`VERDICT`/`RATIONALE` block (score 1..10, supported verdict). Prose
  that merely mentions the markers is still rejected.
- **Repeated final blocks are tolerated when they agree**: some Evaluators repaint
  their terminal (so the final block appears twice) or print the reply template and
  their analysis before the real block. The parser isolates the **final usable
  block** and accepts it when every valid `SCORE` line agrees and every valid
  `VERDICT` line agrees — a redraw is a resolved answer. Genuinely conflicting
  duplicate blocks (different scores or verdicts), template `<placeholder>` echoes,
  out-of-range scores, and unsupported verdicts are still rejected.
- **Rejections are observable, not generic**: when a reply is not accepted, the
  cycle records a specific reason instead of a bare "unparseable". `roll loop cycle
  <id> --roles` distinguishes an Evaluator that **returned score-like text but was
  not accepted** (e.g. conflicting duplicate blocks, a missing field) from one that
  **returned no score content** at all, with the precise reason on the role line.
