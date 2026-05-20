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

After each round decision, emit a `peer` event to the cycle event stream:

```bash
# $round = current round number, $total = max rounds, $verdict = AGREE/REFINE/OBJECT/ESCALATE
# $agents = e.g. "claude→deepseek"
_loop_event peer "${round}/${total}" "$verdict" "$agents" 2>/dev/null || true
```

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
- **Do NOT** prefill the peer with your own root-cause analysis, proposed fix, or leading questions — see the *Independent Judgment Rule* below. The handoff card is for context, not conclusions.

### Anti-Hallucination Rule

When mentioning specific paths, function names, commands, line numbers, or tool results, **must cite the source** ("I read X at line Y"). If unverified, state "unverified" explicitly.

### Independent Judgment Rule (round=1)

The whole point of peer review is to surface a **second, independent** read. If
the reviewer's own root-cause analysis, fix diff, and leading questions are sent
to the peer up front, the peer can only AGREE inside the reviewer's frame — and
that AGREE carries no signal. The reviewer **must complete their own analysis
before opening round=1**; skipping that step turns peer review into a search for
endorsement.

Round=1 message **must NOT include**:

- The reviewer's own root-cause analysis ("the bug is in function X at line Y because…").
- The reviewer's own proposed fix, patch, or diff.
- Leading questions of the form "do you agree with my conclusion on X?" / "is the change I made on Y safe?" — these lock the peer into the reviewer's framing.
- Specific line numbers, function names, or branch points the reviewer has already identified as relevant — let the peer locate them.

Round=1 message **should include**:

- The Project Handoff Card (above).
- Symptoms exactly as observed: the user's reported error, terminal output verbatim, the precise commands that triggered it.
- Necessary external context: the goal of the work, the date / version under test, anything the peer cannot infer from the repo alone.
- Key file pointers as **entry points** (paths only — let the peer choose what to read and how deep).
- An open invitation: "independently identify the root cause, propose a fix, and call out any test gaps."

After receiving the peer's round=1 reply, the reviewer **compares** their own
conclusion to the peer's and routes the next action:

| Reviewer's own conclusion vs. peer's conclusion | Next action |
|---|---|
| Same root cause + same fix direction | High confidence — AGREE and proceed to execution |
| Same root cause, different fix direction | REFINE — open round=2 to reconcile the fix |
| Different root cause | OBJECT — open round=2; at least one of the two analyses is wrong |
| Peer asks for more context | REFINE — supply the missing context, then re-evaluate |

#### Example (bad — endorsement-seeking)

```
Bug is in `cmd_init` at line 932 — the v2 demo renderer fires unconditionally.
My fix: gate it behind `--demo`. Q1: is this over-killed? Q2: should I
refactor the renderer instead? Q3: are the tests strong enough?
```

The peer can only AGREE or quibble inside the reviewer's framing.

#### Example (good — independent analysis)

```
Symptoms: user ran `roll init` on /path/X and saw [verbatim terminal output A];
then ran `roll backlog` and saw [verbatim terminal output B]. Project background:
[project shape]. Entry points: `bin/roll`, `lib/roll-init.py`, `tests/`.
Independently identify the root cause and propose a fix.
```

The peer reads, locates, and proposes on its own. The reviewer then compares.

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
| `claude` | `claude -p "<prompt>"` | ✅ Verified | Native, stable |
| `deepseek` | `deepseek "<prompt>"` | ✅ Verified | No TTY dependency |
| `deepseek` (serve) | `curl localhost:<port>/v1/...` | ✅ High | Start with `deepseek serve --http`; preferred over direct CLI |
| `kimi` | `kimi --quiet -p "<prompt>"` | ✅ Verified | `--quiet` is alias for `--print --output-format text --final-message-only`; prompt via `-p` |
| `pi` | `pi -p "<prompt>"` | ✅ Verified | Clean non-interactive output |
| `opencode` | `opencode run "<prompt>"` | ✅ Verified | Works non-interactively |
| `codex` | `codex exec "<prompt>"` | ⚠️ Auth required | Token must be valid; re-login with `codex login` if expired |

**CLI vs. API Key**: `claude`, `deepseek`, `kimi`, `codex` CLIs authenticate via existing subscription accounts — no separate API key required. This is the primary advantage of CLI transport over the MCP/HTTP approach.

## Inline Display Mode (Manual Triggers)

When peer review is manually triggered by a human (via `/peer`, "叫上 peer", etc.), the executing agent **must display each round inline in the current conversation**. This applies regardless of which agent is executing — Claude, DeepSeek, Kimi, PI, or any other.

**Per-round display format:**

```
─── Peer Review · Round N ───────────────────────────────
→ Sending to [peer]:
{full message sent to peer}

← [peer] responds:
{peer's full response, verbatim}

◆ My analysis: {Claude/executing agent's reaction and position for this round}
─────────────────────────────────────────────────────────
```

**Rules:**
- Peer CLI calls must be **synchronous** (do NOT use background/async execution).
- The outgoing round=1 message must follow the *Independent Judgment Rule* above — no root-cause analysis, no fix diff, no leading questions.
- Show the outgoing message **before** calling the peer, so the user sees what's being asked.
- Relay the peer's response **verbatim** before adding your own analysis.
- After the peer's reply, the reviewer's own analysis block must explicitly state whether the peer's root cause and fix direction match the reviewer's own (independent) conclusion — that comparison is what determines the next round's action.
- If a peer call fails or times out, report it immediately inline and either retry or ESCALATE.
- Negotiation log is still written to `~/.shared/roll/peer/logs/` as usual.

**Why inline, not tmux:** When a human manually triggers peer review inside an agent's interactive session, the conversation IS the visible interface. tmux auto-attach is only relevant for CLI-launched background sessions (`bin/roll peer`), not for skill invocations.

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
- **Decision record**: If AGREE, append summary to `docs/decisions/` or `.roll/backlog.md` (optional)

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
