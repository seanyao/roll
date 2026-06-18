# roll peer — Structured External Review

`roll peer` runs one external-provider reviewer through the same structured
adapter used by goal-mode final review. It is a TS-native command and never
falls back to the retired bash peer surface.

Use `$roll-peer` when you need the full multi-round negotiation protocol inside
an agent workflow. Use `roll peer` when you need a durable one-shot reviewer
fact from Claude, Codex, Kimi, Pi, or another installed external CLI.

## Command Reference

```bash
roll peer --reviewer codex --prompt "Review this plan and return VERDICT/REASON/FINDING lines"
roll peer --reviewer kimi --file /tmp/review-prompt.md --json
roll peer --worker claude --mode hetero --file /tmp/final-review.md
roll peer --mode self --reviewer claude --prompt "Self-check this evidence"
roll peer --timeout-ms 300000 --reviewer pi --file /tmp/review.md
```

Options:

| Option | Meaning |
|--------|---------|
| `--reviewer <agent>` | Use one reviewer directly. |
| `--worker <agent>` | Working agent used for heterogeneous selection. Defaults to this project's configured agent. |
| `--mode auto` | Try heterogeneous reviewers in ranked order; fall back to self-provider only after all heterogeneous candidates fail. |
| `--mode hetero` | Require a different provider; unavailable reviewers produce an `ERROR` fact. |
| `--mode self` | Allow same-provider review. |
| `--prompt <text>` | Inline prompt text. |
| `--file <path>` | Read the prompt from a file. |
| `--json` | Print the structured reviewer fact as JSON. |
| `--timeout-ms <ms>` | Per-review timeout. Default: 180000 ms. |

Reviewer output must contain exactly one verdict line:

```text
VERDICT: APPROVE|REQUEST_CHANGES
REASON: <short reason>
FINDING: <concrete issue>
```

Malformed or multiple verdict lines fail closed as `REQUEST_CHANGES`.

## Recorded Facts

Every run appends one JSON line to:

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

## External Reviewers vs Auxiliary Subagents

`roll peer` is for external-provider reviewer CLIs. Codex-internal subagents are
useful auxiliary analysis workers, but they are not a substitute for external
peer review. The adapter treats `codex-subagent:*` / `subagent:*` identities as
auxiliary and excludes them from heterogeneous reviewer selection.

## Relationship To Pairing

`roll pair` is a build-time gate: a heterogeneous peer re-checks risky delivery
diffs during autonomous cycles and writes cycle evidence. `roll peer` is an
operator command and reusable adapter for one-shot structured reviews. They
share the same provider-diversity principle but serve different workflows.
