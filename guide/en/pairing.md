# Cross-Agent Pairing — heterogeneous second eyes, in the loop

Pairing makes a **different** agent (a different vendor) cross-check your work
automatically. The primitive is the **pair**, not the review: a working agent
delivers, and a heterogeneous peer reviews it for perspective diversity. A code
bug that one model's blind spot hides, another model's catches.

Pairing is distinct from [`roll peer`](peer.md): peer is an on-demand,
multi-round negotiation you (or the loop's risk gate) trigger; pairing is an
always-available, one-way second pass wired into the cycle and governed by an
explicit config file.

## Turning it on — explicit, never silent

```bash
# New project: nothing to do — `roll init` already scaffolds it.
# Existing project: one command adds it.
roll pair init        # scaffold .roll/pairing.yaml from your installed agents
```

- **New projects**: `roll init` scaffolds `.roll/pairing.yaml` for you (and the
  init UI says so) — no separate step.
- **Existing roll projects**: just run `roll pair init`. It is the precise,
  minimal command — you do **not** need to re-run the full `roll init` (that
  would also re-merge conventions; overkill for adding pairing).

Both paths produce the identical file (same scaffold logic), and `roll pair init`
is idempotent (it won't overwrite an existing `pairing.yaml` — use `--force` to
regenerate).

This is the "third way" between a hidden default-on and hand-authored opt-in:
the command **generates** an explicit, auditable `.roll/pairing.yaml` from
`roll agents list`, writing every default into the file (not a hidden code
default). **The file's presence is the switch** — present = pairing on, delete
it = off. Pairing never fires silently.

```yaml
# .roll/pairing.yaml — generated, edit freely
enabled: true
stages: [code]
capability:
  claude: [code]
  codex: [code]
  kimi: [code]
```

- `enabled` — master switch. `roll pair init` sets it `true` only when at least
  two **distinct vendors** are installed (otherwise there is no heterogeneous
  peer to pair with).
- `stages` — which lifecycle stages trigger pairing: `design`, `test`, `code`,
  `cycle`. Each is independently opt-out. Default is `code`.
- `capability` — per agent, the stages it is declared competent to review.
  Declarations are cross-checked against the registry, so a bogus name is
  rejected.

## Seeing what it does — observability

```bash
roll pair status
```

shows the pool (who can pair, their vendor, declared capability, and **why** an
agent is excluded), plus **how much pairing has cost**:

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
available, declared capable for that stage, and a **different vendor** from the
working agent — then rotates among them (seeded by the cycle id, so it is
replayable). Agents with a track record are gently preferred (ε-greedy, ε≈0.2),
but exploration is always preserved so no single pair monopolizes. If no
qualified heterogeneous peer exists, that absence is itself recorded
(`pair:none-available`) — never a silent skip.

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

## Scoring — the pair grades the cycle, not the author

An agent grading its own delivery is a conflict of interest, so the cycle's
quality score is itself a pairing scenario (`score` stage):

- **In the loop**: after the acceptance gate passes, the runner asks the
  paired heterogeneous agent to score the delivery. The note lands in the
  card's `notes/` with provenance — `scoring: pair` and `scored-by: <agent>`.
- **Manually**: `roll pair score <story-id> --summary "<delivery summary>"`
  runs the same adapter from a session.
- **Fallback, never a blocker**: no heterogeneous candidate, a timeout, or a
  protocol miss degrades to the classic self-score —
  `roll self-score <skill> <story> <score> <verdict> "<rationale>"
  --fallback-reason "<why>"` — and the absence is audited via a
  `pair:none-available` event. Both commands are idempotent.
