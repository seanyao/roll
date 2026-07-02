# $roll-peer — Structured External Review

`$roll-peer` runs external-provider review through the same structured adapter
used by goal-mode final review. The old top-level peer CLI is retired; invoke
the skill from an agent workflow when you need this capability.

Use `$roll-peer` when you need the full multi-round negotiation protocol, or
when a durable reviewer fact from Claude, Codex, Kimi, Pi, or another installed
external CLI should be recorded.

## Prompt Shape

```text
$roll-peer
Review this plan and return VERDICT / REASON / FINDING lines.
```

Reviewer output must contain exactly one verdict line:

```text
VERDICT: APPROVE|REQUEST_CHANGES
REASON: <short reason>
FINDING: <concrete issue>
```

Malformed or multiple verdict lines fail closed as `REQUEST_CHANGES`.

## Recorded Facts

Every accepted review appends one JSON line to:

```text
.roll/peer/runs.jsonl
```

When a reviewer process produced output, the transcript is also written under:

```text
.roll/peer/transcripts/
```

The recorded fact includes reviewer agent, provider, command family, verdict,
reason, findings, timeout/error state, duration, transcript path, and evidence
path. Goal-mode final review emits the same fact fields on `goal:final_review`.

## Parse Failures

When a reviewer or scorer runs inside an autonomous cycle but its output is
**unparseable** (for example, control characters before the `SCORE` line, or a
missing `VERDICT` line), the attempt is not silently dropped. The raw attempt is
captured under `.roll/loop/peer/`, and the agent's row in the cycle role cast
shows `failed` with a `cause` and a `raw artifact:` pointer.

See [Cycle Role Visibility](./loop.md#cycle-role-visibility) for how to read
that cast, and
[Troubleshooting unparseable score/review](../../docs/live-console.md#troubleshooting)
for recovery steps.

## External Reviewers vs Auxiliary Subagents

`$roll-peer` is for external-provider reviewer CLIs. Codex-internal subagents are
useful auxiliary analysis workers, but they are not a substitute for external
peer review. The adapter treats `codex-subagent:*` / `subagent:*` identities as
auxiliary and excludes them from heterogeneous reviewer selection.

## Relationship To Pairing

Loop pairing is a build-time gate: a heterogeneous peer re-checks risky delivery
diffs during autonomous cycles and writes cycle evidence. `$roll-peer` is the
agent-invoked negotiation skill for structured external review. They share the
same provider-diversity principle but serve different workflows.
