# Roll — Agent Pool and Role Casting

> US-AGENT-049 — Roll casts Designer, Builder, Evaluator, and Peer Reviewer from one open agent pool, ranking candidates by capability, health, and cost instead of applying broad identity bans.

## Open-pool casting

Roll does not reject talent because of brand, provider, or current Supervisor identity. The four casting roles read from the same installed agent pool unless owner policy explicitly narrows it:

- `designer` — plans and scopes work (maps to the `supervise` scope role).
- `builder` — implements stories and fixes (maps to the `execute` scope role).
- `evaluator` — scores and reviews delivery in a fresh session (maps to the `evaluate` scope role).
- `peer_reviewer` — cross-checks high-risk changes.

## Health-aware ranking

When a role binding uses `strategy: health-aware`, Roll ranks every candidate and explains the choice:

```yaml
schema: roll-agents/v1
scope: project
inherits: machine
defaults:
  story:
    roles:
      execute:
        kind: select
        from: [codex, kimi, pi, reasonix, agy, claude]
        require: [execute]
        strategy: health-aware
```

The ranker considers:

- role capability tags (`canExecute`, `canReview`, `canScore`)
- observed health signals (`auth`, `timeout`, `parser`, `no_tcr`, `publish`, `cost`)
- recent outcomes (success / failure / gave_up)
- cost band
- story risk

A degraded agent stays visible in the candidate list but is not selected ahead of healthy candidates only because it is least recent.

## Inspecting the cast

```bash
roll supervisor route --role builder --story US-XXX
roll supervisor route --role builder --story US-XXX --json
```

Example output:

```text
builder candidates:
  kimi      score  82  eligible · healthy · strong builder · can builder
  pi        score  74  eligible · healthy · good evaluator/build candidate · can builder
  codex     score  72  eligible · healthy · fresh-session capable · can builder
  reasonix  score  61  eligible · healthy · cheap · weaker Builder reliability on broad UI/workflow cards · can builder
  claude    score  55  eligible · healthy · capable generalist · high cost · can builder
  agy       score  25  not eligible · auth degraded · can build · can builder
selected: kimi
```

## Session independence

Role independence is enforced by fresh session IDs and artifact handoff, not by excluding the same brand or provider. A Builder cannot satisfy its own Evaluator gate through the same session, even when same-brand independent sessions are allowed.

## Recovery

A blocked agent re-enters normal ranking after a successful probe or a fresh successful cycle. If every candidate is degraded, Roll fails loud rather than silently choosing a blocked agent.
