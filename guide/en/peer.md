# roll peer — Cross-Agent Code Review

`roll peer` sends a plan or diff to a second AI agent for review.
Loop auto-triggers peer review before risky builds; you can also invoke it manually.

## How Peer Review Works

```
roll peer --from claude --to kimi --context plan.md

  Claude submits plan → Kimi reviews → Returns verdict
```

Peer review is a one-round-or-more negotiation:

| Verdict | Meaning | What happens next |
|---------|---------|------------------|
| **AGREE** | Plan looks good | Proceed to build |
| **REFINE** | Plan needs adjustments | Incorporate feedback, re-submit |
| **OBJECT** | Significant disagreement | Reconsider approach, re-submit |
| **ESCALATE** | Cannot resolve | Human decision required |

After 3 rounds without AGREE, the review escalates automatically.

## Command Reference

```bash
# Basic: ask kimi to review a plan from claude
roll peer --from claude --to kimi --context plan.md

# Auto-select peer (uses capability map)
roll peer --from claude

# Specify round (used by loop internally on multi-round reviews)
roll peer --from claude --to kimi --round 2 --context plan.md

# Skip the 10-second opt-out prompt
roll peer --from claude --yes

# Tag-based routing (e.g. "security" or "architecture" tag)
roll peer --from claude --tag security

# Check peer pair health
roll peer status

# Reset a degraded/abandoned pair
roll peer reset claude kimi
```

## Auto-Trigger Conditions

Loop (and `$roll-build`) auto-triggers peer when:

- Plan affects >3 files or crosses module boundaries
- Architecture decisions or non-obvious trade-offs are involved
- Destructive operations (deletions, migrations, production deploys)
- High-risk keywords in the request: "critical", "don't break", "关键", "别搞砸"

A 10-second opt-out prompt appears before peer fires:

```
Plan affects 5 files across 3 modules. Estimated peer review: 2–3 rounds.
Press Enter to launch, or type 'n' to skip. Auto-executing in 10s...
```

## Capability Map

By default, peer routes to: `kimi → claude → pi` (in preference order).

Configure in `~/.roll/config.yaml`:

```yaml
peer_capability_map_default: "kimi claude pi"
peer_capability_map_security: "kimi deepseek claude"
peer_capability_map_architecture: "claude kimi"
```

Supported peer agents: `claude`, `kimi`, `pi`, `deepseek`, `codex`, `opencode`.
Loop skips agents that are not installed on the current machine.

## Visibility (tmux + popup)

Like loop, peer review runs inside a tmux session (`roll-peer-<from>-<to>`).
When not muted, a terminal window opens so you can watch the negotiation in real time.

The session stays alive across rounds so you can watch the entire multi-round negotiation
in one window. After a terminal resolution (AGREE, ESCALATE, UNKNOWN, or round ≥ 3),
the session is automatically cleaned up — the tmux session is killed and the terminal
window closes.

The `mute` file (`~/.shared/roll/mute`) controls popup for both loop and peer.
`roll loop mute` / `roll loop unmute` applies to all autonomous activity.

## Peer State Machine

Each `from→to` pair maintains a health state:

| State | Meaning |
|-------|---------|
| `active` | Pair is healthy, last outcome was AGREE |
| `degraded` | 1–2 consecutive non-AGREE outcomes |
| `abandoned` | 3+ consecutive failures — pair is suspended |

Check state with `roll peer status`. Reset with `roll peer reset <from> <to>`.

## Logs

Peer review logs are saved to:

```
~/.local/share/roll/peer/logs/YYYYMMDD_HHMMSS_<from>_<to>.md
```

Each log contains the full prompt and response for every round.
