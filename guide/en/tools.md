# Roll — Tools & Policy

Roll's tools layer is the governed path for side effects that a delivery cycle performs: shell commands, browser inspection, filesystem access, git, GitHub, network fetches, and MCP calls.

Tools are not a replacement for an AI client's own tool allowlist. Client-level `allowed-tools` controls what the inner agent may ask for. Roll's tool layer controls what the outer harness registers, how project policy is resolved, what events are recorded, and how costs appear in cycle evidence.

See the tools-layer design plan in [../../.roll/features/tools-layer/plan.md](../../.roll/features/tools-layer/plan.md).

## Concepts

| Concept | Meaning |
|---------|---------|
| Tool declaration | The shared contract for a tool: id, kind, title, defaults, requirements, and input/output schema. |
| Registry | The core path that registers tools, resolves policy, invokes adapters, emits events, retries, and snapshots costs. |
| Adapter | The infra implementation for one tool family, such as `bash`, `browser.screenshot`, `git.push`, or `network.fetch`. |
| Policy | The effective settings from declaration defaults plus `.roll/policy.yaml` overrides. |
| Evidence | `tool:invoke`, `tool:result`, cycle cost rows, CLI output, attest reports, and dashboard timeline rows. |

Registered tool families today:

| Family | Tool ids |
|--------|----------|
| Bash | `bash` |
| Browser | `browser.screenshot`, `browser.console`, `browser.dom-query` |
| Filesystem | `filesystem.stat`, `filesystem.read`, `filesystem.write` |
| Git | `git.status`, `git.commit`, `git.push`, `git.merge` |
| GitHub | `github.pr`, `github.ci` |
| MCP | `mcp.call` |
| Network | `network.fetch` |

Browse the full built-in tool catalog — every tool with its capability, input/output contract, default guardrails, and requirements — on the machine-global **Tools** page (`tools.html`), one of the `MACHINE › …` breadcrumb pages alongside Agents and Skills.

## Project Policy

Tool policy lives under the `tools:` section of `.roll/policy.yaml`.

```yaml
tools:
  bash:
    enabled: true
    timeoutMs: 30000
    maxInvocationsPerCycle: 20
    sandbox:
      allowedPaths: [.]
      blockedCommands: [sudo]
      maxOutputBytes: 65536

  browser.screenshot:
    timeoutMs: 60000
    sandbox:
      headlessOnly: true
      allowedOrigins: [http://localhost:4173]

  network.fetch:
    retry:
      attempts: 2
      backoffMs: 250
    sandbox:
      network: restricted
      allowedOrigins: [https://api.example.com]
```

Supported fields:

| Field | Scope | Meaning |
|-------|-------|---------|
| `enabled` | tool | `false` blocks invocation through policy. |
| `timeoutMs` | tool | Soft timeout used by the adapter unless the input has a narrower limit. |
| `retry.attempts` | tool | Maximum attempts for adapters that support retry. |
| `retry.backoffMs` | tool | Delay between retry attempts. |
| `maxInvocationsPerCycle` | tool | Per-cycle budget limit enforced by the registry. |
| `sandbox.allowedPaths` | sandbox | Path allowlist for filesystem-like adapters. |
| `sandbox.blockedCommands` | sandbox | Advisory command blocklist for bash. |
| `sandbox.hardTimeoutSec` | sandbox | Hard execution limit for adapters that support it. |
| `sandbox.maxOutputBytes` | sandbox | Output truncation limit. |
| `sandbox.allowedOrigins` | sandbox | Network or browser origin allowlist. |
| `sandbox.headlessOnly` | sandbox | Browser lane must stay headless. |
| `sandbox.network` | sandbox | `inherit`, `restricted`, or `blocked`. |

Unknown fields warn but do not reject the policy file, so newer Roll versions can add fields without breaking older project configs.

## Owner Chrome: manual interactive lane

`roll browser interactive` is a manual, owner-run boundary for one typed low-risk action against an already-open, loopback Chrome DevTools endpoint. It requires an attached TTY and a fresh `y` approval for every invocation. The prompt names the story, approved origin, action summary, 15-minute maximum expiry, and credential-export denial.

```text
roll browser interactive --story US-BROW-008b --origin https://app.example.test \
  --action navigate --url https://app.example.test/account
```

It connects only to a tab whose origin matches `--origin`, then disconnects DevTools on approval expiry, cancellation, errors, or process exit. Roll never launches or closes the owner's Chrome. The closed action vocabulary is `navigate`, `click`, `fill`, and `press_key`; cookies, storage, and network bodies have no CLI or adapter surface. A successful interactive result is manual evidence only: it does not make CI pass and cannot become background automation.

## CLI

Use `roll doctor tools status` to inspect the registered tools, input contracts, requirement readiness, and the effective policy state for the current project.

```bash
roll doctor tools status
```

Example output:

```text
tool              kind        enabled  readiness    timeout  limit  contract                                       sandbox
bash               bash        yes      available    30000    -      args?, command, cwd?, env?                     maxOutputBytes=65536
browser.screenshot browser     yes      available    60000    -      screenshotPath?, url, viewport?, waitFor?      headlessOnly=true,maxOutputBytes=2097152
network.fetch      network     yes      available    30000    -      body?, headers?, method?, timeoutMs?, url      network=restricted
```

Use it after editing `.roll/policy.yaml` to confirm Roll sees the intended state.

## Complete Example

This example locks browser screenshots to a local dev server, confirms the effective policy, and then verifies where the tool evidence appears after a delivery.

1. Configure browser and network policy for the project:

```yaml
tools:
  browser.screenshot:
    timeoutMs: 60000
    sandbox:
      headlessOnly: true
      allowedOrigins: [http://localhost:4173]

  network.fetch:
    timeoutMs: 10000
    retry:
      attempts: 2
      backoffMs: 250
    sandbox:
      network: restricted
      allowedOrigins: [http://localhost:4173]
```

2. Confirm Roll resolved the policy:

```bash
roll doctor tools status
```

Expected rows:

```text
browser.screenshot browser     yes      60000    -      allowedOrigins=http://localhost:4173,headlessOnly=true,maxOutputBytes=2097152
network.fetch      network     yes      10000    -      allowedOrigins=http://localhost:4173,network=restricted
```

3. Run a delivery that has a visible web surface. The story spec should declare the page it wants captured:

```yaml
---
deliverable_url: http://localhost:4173
---
```

During attest, Roll captures the page through `browser.screenshot`. The exposed Roll tool id is `browser.screenshot`; Playwright or Chrome may be used underneath, but `playwright` is not a policy key or tool id.

4. Inspect the evidence:

```bash
roll loop cycle <cycle-id>
```

Look for rows like:

```text
tools browser.screenshot×1(2.0s) network.fetch×1(0.4s)
```

In the story attest report and cycle views, the same event stream appears as:

| Evidence | What to check |
|----------|---------------|
| `tool:invoke` | Tool id, caller cycle, resolved policy. |
| `tool:result` | Success or error code, duration, output path. |
| Screenshot link | A `.roll/tool-dumps/...png` or attached card screenshot path. |
| Cost row | Currency is preserved as USD, CNY/RMB, or `¥`; mixed currencies are not collapsed into one fake total. |

## Evidence And Cost

`roll loop status`, `roll loop cycle`, and attest reports show tool summaries from the event stream. Failed tool calls keep their error codes, and screenshot tools can link directly to captured images.

Tool costs preserve their native currency. USD rows stay USD. CNY/RMB rows stay CNY/RMB or `¥`. Roll does not relabel RMB-denominated tool or model costs as dollars and does not blindly add mixed currencies into one number.
