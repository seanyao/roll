---
name: roll-peer
license: MIT
allowed-tools: "Read, Bash, Write, Edit"
description: |
  Cross-agent peer review skill. When a task enters a decision phase (planning,
  high-risk, ambiguous, destructive), triggers a bidirectional negotiation with
  another AI agent via a unified protocol. Up to 3 rounds. If consensus is not
  reached, escalates to the human user. Includes adaptive peer routing based on
  task type and historical success rate.
  Trigger: /peer, "叫上 peer", "peer review", or auto-triggered at workflow gates.
---

# Roll Peer (Cross-Agent Peer Review)

> Follows the Architecture Constraints, Development Discipline, and Engineering
> Common Sense defined in the project AGENTS.md.

## Credits

Cross-agent consultation protocol inspired by
[friend-skill](https://github.com/fpyluck/friend-skill) (MIT) by fpyluck.
Independent implementation for the Roll toolchain.

## Trigger

**Manual:**
- `/peer`
- "叫上 peer"
- "peer review 一下"
- "和 peer 商量"

**Auto-triggered (with 10s opt-out):**
- `roll-build` enters Plan Mode (executable plans / architecture decisions)
- `roll-spar` Attacker and Defender disagree
- High context pressure (large number of files read / tools executed)
- Destructive / irreversible operations (`rm -rf`, production deploy, global config changes)
- High-risk signal words ("重要 / 关键 / 别搞砸 / important / critical")
- Cross-repository / cross-toolchain / ambiguous permission boundaries

**Never trigger:**
- Single-file changes
- Clear, well-defined fixes
- Simple refactoring

## Protocol: `[PEER_REVIEW]`

### Marker Format

The marker **must** appear on the first non-empty line of the message:

```markdown
[PEER_REVIEW round=N tool=<from>→<to>]
```

- `round=N`: Current round number (1–3)
- `tool=<from>→<to>`: Direction of this message (e.g., `kimi→claude`)

### Three-State Resolution + Escape

Allowed states only. No invented words.

- **AGREE**: Accept the current proposal. Proceed to execution.
- **REFINE**: Direction is correct, but specific changes are needed. Proceed to next round.
- **OBJECT**: The proposal is wrong. Provide an alternative. Proceed to next round.
- **ESCALATE**: Round 3 reached without AGREE, or a round fails due to API/token error. Hand off to the human user.

If information is insufficient:
```
REFINE: Need to confirm X/Y/Z with the user first.
```

### Context Handoff Card (required for round=1)

When the task involves a local project, the first message must include:

```markdown
## Project Handoff (round=1 required)
- Project root: <absolute path>
- Execution environment: <shell / container / devcontainer / remote / N/A>
- Project type: <language + framework>
- Virtual environment: <absolute path / conda env / container name / N/A>
- Activation command: <one-line executable string, or N/A>
- Key tool calls:
  - test: <one-line command or N/A>
  - build: <one-line command or N/A>
  - run: <one-line command or N/A>
  - lint: <one-line command or N/A>
- Key conventions / constraints: <2–3 items, or N/A>
- Related file pointers: <absolute paths or @references, or N/A>
```

Rules:
- Paths must be **absolute**.
- Commands must be **one-line executable strings**, not descriptions.
- Prefer commands that do **not** require an activated environment (absolute interpreter paths, `uv run`, `docker compose exec`).
- Do not copy README text. List file pointers only.
- Never include secrets, tokens, credentials, or `.env` content.
- Even if logically a continuation, treat as round=1 if the peer has **no prior context**.

### Anti-Hallucination Rule

When mentioning specific paths, function names, commands, line numbers, or tool results, **must cite the source** ("I read X at line Y"). If unverified, state "unverified" explicitly.

## State Machine

### Per Negotiation (Single Task)

```
Running
  ├── AGREE (any round)     → Execute proposal
  ├── Round == 3, no AGREE  → ESCALATE (failed_max_rounds)
  ├── API/token error        → ESCALATE (failed_api_error)
  └── User aborts            → ESCALATE (user_abort)
```

### Per Peer Pair (e.g., kimi→claude)

Stored in `~/.shared/roll/peer/state.yaml`:

```yaml
kimi→claude:
  status: active        # active | degraded | abandoned
  streak: 0             # consecutive failure count
  last_outcome: agreed
  history:
    - { time: "2026-05-08T23:30:00+08:00", outcome: agreed, rounds: 2, tag: architecture }
```

Rules:
- `streak >= 3` → automatically mark as `abandoned`
- `abandoned` peer pairs are skipped by the bridge script
- Human can reset via `roll peer reset <from> <to>` or `roll peer reset --all`
- If a peer pair is abandoned, the bridge falls back to the next candidate in the capability map

## Peer Routing (Adaptive)

### Capability Map (Task Type → Preferred Peer Order)

```yaml
peer:
  capability_map:
    architecture: [claude, deepseek, kimi, pi]
    security: [claude, deepseek, pi, kimi]
    test: [codex, kimi, deepseek, claude]
    refactor: [deepseek, kimi, claude, pi]
    default: [deepseek, kimi, claude, pi]
```

### Adaptive Adjustment

After each negotiation, record:
- `outcome`: agreed / failed_max_rounds / failed_api_error
- `rounds`: number of rounds consumed
- `tag`: task type

If `streak` for a peer pair reaches the configured threshold (default: 3 consecutive failures), mark as `abandoned`. The next task of the same type will try the next candidate in `capability_map`.

### Peer Detection

The bridge script detects installed peers via `command -v <tool>`. Only installed tools are considered. The current running tool is excluded (`exclude_self: true`).

For `deepseek`, also check if serve mode is available as a more reliable alternative:
```bash
command -v deepseek && { deepseek serve --help 2>/dev/null; true; } | grep -q "\-\-http" && echo "serve_mode"
```
If serve mode is available, prefer HTTP transport over direct CLI invocation.

### Peer Invocation Reference

| Peer | Non-interactive command | Reliability | Notes |
|------|------------------------|-------------|-------|
| `claude` | `claude -p "<prompt>"` | ✅ High | Native, stable |
| `deepseek` | `deepseek "<prompt>"` | ✅ Good | No TTY dependency |
| `deepseek` (serve) | `curl localhost:<port>/v1/...` | ✅ High | Start with `deepseek serve --http`; preferred over direct CLI |
| `kimi` | `kimi --quiet "<prompt>"` | ⚠️ Unverified | Verify non-interactive support before use |
| `codex` | `codex exec --json --output-last-message "<prompt>"` | ⚠️ Unstable | Known CI failures due to Ink/TTY (issues [#1080](https://github.com/openai/codex/issues/1080), [#1340](https://github.com/openai/codex/issues/1340)); use only as fallback |
| `pi` | `pi -p "<prompt>"` | ⚠️ Unverified | Verify non-interactive support before use |

**CLI vs. API Key**: `claude`, `deepseek`, `kimi`, `codex` CLIs authenticate via existing subscription accounts — no separate API key required. This is the primary advantage of CLI transport over the MCP/HTTP approach.

## Workflow Integration

### `roll-build` Plan Mode

After generating an executable plan, before proceeding to TCR:

1. Assess plan complexity (file count, cross-module impact, risk level)
2. If complexity > threshold, prompt user:
   ```
   This plan affects 5 files across 3 modules. Estimated peer review: 2–3 rounds, ~X tokens.
   Press Enter to launch peer review, or type 'n' to skip. Auto-executing in 10s...
   ```
3. If user does not abort within 10s, invoke `roll peer` with `--tag architecture`
4. Wait for result:
   - AGREE → proceed to TCR
   - REFINE/OBJECT → incorporate feedback and regenerate plan
   - ESCALATE → present both proposals to user for final decision

### `roll-spar`

When Attacker and Defender reach a stalemate (both tests pass but interpretations differ):

1. Auto-invoke `roll peer` with `--tag test`
2. Use the peer's verdict as tie-breaker

## Output Artifacts

- **Negotiation log**: `~/.shared/roll/peer/logs/<timestamp>_<from>_<to>.md`
- **State file**: `~/.shared/roll/peer/state.yaml`
- **Decision record**: If AGREE, append summary to `docs/decisions/` or `BACKLOG.md` (optional)

## Configuration

User overrides in `~/.roll/config.yaml`:

```yaml
peer:
  max_rounds: 3
  opt_out_seconds: 10
  call_timeout: 180        # seconds per round; configure based on your API latency
  fallback: file_mailbox    # direct_cli | file_mailbox | auto
  capability_map:
    architecture: [claude, deepseek, kimi, pi]
    security: [claude, deepseek, pi, kimi]
    test: [codex, kimi, deepseek, claude]
    refactor: [deepseek, kimi, claude, pi]
    default: [deepseek, kimi, claude, pi]
  adaptive:
    streak_threshold: 3
    min_samples: 3
```

## Limitations

1. **Reverse link reliability**: Direct CLI calls are preferred. Reliability varies by tool — see Peer Invocation Reference table. If a peer fails consistently, the adaptive streak tracker marks it `abandoned` and falls back to the next candidate. File mailbox (`~/.shared/roll/peer/mailbox/`) is the last-resort fallback.
   - `deepseek serve --http` is the most reliable option when available — prefer it over direct `deepseek` CLI invocation.
   - `codex exec` has known TTY/Ink issues in non-interactive environments; treat as low-priority fallback.
2. **Cost**: Every peer review consumes tokens on both sides. Only trigger for tasks where the cost of a wrong decision exceeds the cost of peer review. DeepSeek is the most cost-effective peer for general use.
3. **Context window**: Large project handoff cards may consume significant context. Keep file pointers concise.
4. **Tool differences**: Claude, DeepSeek, Kimi, Codex, and Pi interpret skills and AGENTS.md differently. The peer may apply the protocol slightly differently. This is expected and acceptable — the protocol is designed to tolerate variation.
