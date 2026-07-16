# Roll — Browser Operations (managed + interactive lanes)

Roll can drive a **managed, isolated Chrome via the real `chrome-devtools-mcp` sidecar**
to collect browser diagnostics — navigation checks, DOM snapshots, console and
network capture, and diagnostic screenshots. Each managed operation spawns a
pinned-version `chrome-devtools-mcp` stdio session under a temporary Chrome
profile; the session performs MCP initialize + tools/list, validates a minimum
tool manifest, and only then executes the requested action. The profile is
removed afterwards.

A separate **interactive owner-Chrome lane** supports a single, low-risk
operation against an already-open localhost debug endpoint, with foreground
owner approval and strict lease controls.

Both lanes are opt-in, dependency-gated, and deliberately narrow.

Two things they are **not**:

- They are **not** installers. Roll never adds a dependency to your product
  repo's `package.json`, and never enables remote debugging on your own
  (owner) Chrome. Setup only writes a machine-level config after you confirm.
- Their output is **not** visual acceptance evidence. A managed diagnostic
  screenshot or an interactive owner-run result proves a page action succeeded;
  neither satisfies a story's visual AC. Only **Roll Capture** (a physical
  screenshot of your real terminal/app) satisfies visual acceptance — see
  [Acceptance evidence](acceptance-evidence.md).

---

## Privacy & Security Boundaries

These invariants hold across every operation, managed or interactive:

- **Temporary profile only.** Managed Chrome runs under a fresh temporary
  profile that is deleted after the operation. Owner browser state (cookies,
  logins, history, localStorage) is never entered, read, or exported.
- **No credential export.** Cookies, storage, and network bodies have no CLI
  or adapter surface. Neither lane can export owner credentials.
- **Telemetry disabled.** `chrome-devtools-mcp` is started with
  `--no-usage-statistics`. No data is sent to Chrome, CrUX, Lighthouse, or
  any external telemetry service.
- **Bounded, redacted diagnostics.** Diagnostic artifacts (console summaries,
  network metadata, performance counters) are bounded to a fixed allowlist of
  numeric metrics and redacted of URLs, resource names, and traces. See
  [Optional diagnostic profiles](#optional-diagnostic-profiles).
- **No generic MCP bypass.** Only the pinned `chrome-devtools-mcp` transport
  is registered for browser operations. A generic `mcp.call` directed at
  DevTools is rejected (fail-closed).
- **DevTools artifacts never satisfy visual AC.** Diagnostic screenshots and
  DOM snapshots are classified as diagnostic-only; they cannot earn a
  visual-acceptance verdict. See [Evidence boundary](#evidence-boundary).
- **No automatic Chrome startup.** Roll never launches or closes your owner
  Chrome. The interactive lane connects only to a Chrome debug endpoint you
  started yourself on a loopback address.
- **Machine-level config only.** Setup writes `~/.roll/browser-operations.yaml`
  — never a product repo file — and only with `--confirm`.

---

## Managed Lane

The managed lane is the **primary browser-operation path**. It launches Chrome
under a fresh temporary profile, spawns the pinned `chrome-devtools-mcp` sidecar,
runs one operation against an allowlisted target, and removes the profile
afterwards.

### Prerequisites & Doctor

The managed lane needs the pinned `chrome-devtools-mcp` transport and a Chrome
binary. Roll does not install these — it reports what is missing and how to fix
it. Start with the static doctor:

```bash
roll browser doctor
```

```
Browser operations doctor
浏览器操作体检

~ managed:     degraded — chrome-devtools-mcp not ready; existing Playwright and Roll Capture paths remain usable
    → roll browser setup --dry-run
    → install the missing dependency, then re-run roll browser doctor
✓ interactive: ready    owner Chrome reachable on 127.0.0.1:9222
~ capture:     degraded — Roll Capture readiness probe skipped (headless / CI / ROLL_NO_SCREENCAP).
```

Each lane reports one of three honest states:

| State | Meaning |
|-------|---------|
| `ready` | The lane's prerequisites are satisfied. |
| `degraded` | The lane is unavailable or partially available. Existing Playwright and Roll Capture paths keep working — a missing prerequisite is never reported as a pass. |
| `blocked` | A hard precondition prevents the lane from running; the reason and repair command are printed. |

The static doctor inspects the machine environment and configuration. It does
**not** spawn `chrome-devtools-mcp` — a `ready` verdict from the static doctor
means the binary and config are present; it does not prove the MCP sidecar
initializes correctly.

### Live MCP Probe (`doctor --probe`)

`doctor --probe` runs a **real, temporary `chrome-devtools-mcp` session** to
validate the full transport lifecycle end-to-end. Only a successful probe
advances the managed lane to `ready` in the doctor output.

```bash
roll browser doctor --probe
```

```
Browser operations doctor --probe
浏览器操作体检 --probe

⏳ Running live MCP lane probe — this will:
   1. Spawn the pinned chrome-devtools-mcp session (temporary process)
   2. Run MCP initialize + tools/list + manifest validation
   3. Close the session and clean up the temporary Chrome profile
The probe may take a few seconds. No owner state enters the temporary profile.

⏳ 正在运行实时 MCP 通道探测——将会：
   1. 启动固定版本的 chrome-devtools-mcp 会话（临时进程）
   2. 运行 MCP initialize + tools/list + 清单验证
   3. 关闭会话并清理临时 Chrome 档案
探测可能需要几秒。绝不会进入 owner 状态。

✅ Live probe passed — managed lane is ready.
✅ 实时探测通过——受管通道就绪。

✓ managed:     ready    chrome-devtools-mcp 1.5.0 (8 tools) — live probe passed
```

The probe lifecycle:

1. **Spawn** — a temporary `chrome-devtools-mcp` stdio process starts with the
   pinned version and `--no-usage-statistics`.
2. **Initialize** — MCP `initialize` handshake completes.
3. **Validate** — `tools/list` runs; the response is checked against the minimum
   tool manifest (navigate, snapshot, console, network, screenshot).
4. **Close & clean** — the MCP process and temporary Chrome profile are removed.

A failed probe categorizes each failure honestly:

```
❌ Live probe failed — see categorized failures below.
❌ 实时探测失败——见下方分类失败信息。
   transport: chrome-devtools-mcp not installed or not on PATH
   manifest: tool manifest missing required entries (expected: navigate, snapshot, console, network, screenshot; got: [])
   chrome: chrome binary not found at expected path
```

Re-run `doctor --probe` after fixing the reported issues. The static doctor
(without `--probe`) remains available for quick environment checks; it reports
the lane as `configured` when the binary and config are present but the probe
has not yet passed.

### Setup (dry-run first)

`setup --dry-run` shows the exact machine-level config Roll would write and runs
the dependency preflight. It writes **nothing**:

```bash
roll browser setup --dry-run
```

```
Browser operations setup
浏览器操作安装

  target (machine-level, never committed): ~/.roll/browser-operations.yaml

  proposed ~/.roll/browser-operations.yaml:
    devtools:
      command: npx
      args: ["-y", "chrome-devtools-mcp@1.5.0", "--no-usage-statistics"]
      package: chrome-devtools-mcp
      package_version: 1.5.0
      chrome_channel: stable
      remote_debugging: { host: "127.0.0.1", port: 9222 }
  ...
  Roll never installs into a product package.json and never enables owner Chrome remote debugging.
  Roll 绝不改动产品仓 package.json，也绝不自动开启 owner Chrome 的远程调试。

  dry-run: no configuration was written.
```

Only after you review it do you write the config, and only with explicit
confirmation:

```bash
roll browser setup --confirm
```

Without `--confirm` (and without `--dry-run`), `setup` refuses and writes
nothing.

### Running a Managed Operation (Real MCP Lane)

`roll browser run` with `--story` and `--url` executes through the **real,
policy-gated MCP lane**. This is the production path. The project must first
opt in via `.roll/policy.yaml` (everything is disabled by default):

```yaml
browser_operations:
  enabled: true
  managed:
    enabled: true
    allowed_origins: [https://example.com]
    allowed_actions: [navigate, snapshot, console, network, screenshot]
    max_runs_per_cycle: 20
    timeout_ms: 30000
```

```bash
roll browser run \
  --story US-BROW-021 \
  --url https://example.com \
  --action screenshot
```

Verbatim output (captured from a real run, 2026-07-16):

```
Managed browser operation — real MCP
受管浏览器操作 — 真实 MCP

  mcp package / MCP 包:  1.5.0
  transport initialized / 传输初始化:  yes
  manifest verified / 清单验证:  yes
  lane / 通道:            managed
  action / 动作:          screenshot
  target / 目标:          https://example.com
  run state / 运行状态:   passed
  result / 结果:          pass (action: ok)
  temp profile / 临时档案: removed (owner state never entered / 绝不进入 owner 状态)
  diagnostics / 诊断产物:  1 (diagnostic-only, NOT visual acceptance / 仅诊断，非视觉验收)
  summary / 摘要:         diagnostic screenshot recorded

  Diagnostic success is not visual acceptance evidence.
  诊断通过不等于视觉验收证据。
```

Supported actions: `navigate` (default), `snapshot`, `console`, `network`,
`screenshot`.

The MCP session lifecycle is:

1. **Policy check** — the project's `.roll/policy.yaml` must enable the managed
   lane (`browser_operations.enabled: true` plus `managed.enabled: true` with an
   origin allowlist). With no explicit policy everything is disabled, and the
   run is **denied** before any process starts.
2. **Session spawn** — the pinned `chrome-devtools-mcp` starts with a fresh
   temporary Chrome profile.
3. **MCP handshake** — `initialize` → `tools/list` → manifest validation.
   Any failure here aborts the run (`devtools-error`).
4. **Action execution** — the requested action runs against the allowlisted
   target.
5. **Cleanup** — the MCP process is terminated; the temporary profile is
   deleted (even on timeout or crash).

A target outside the allowlist — including a redirect away from the requested
origin — is **denied**, not followed. A `--story` identifier is **required** for
the real lane; it is recorded in the operation ledger for auditability.

#### Blocked / Unavailable Transcript

When the managed lane is unavailable or policy-denied, the run fails loud.
Verbatim output with no `.roll/policy.yaml` present (captured 2026-07-16):

```
Managed browser operation — real MCP
受管浏览器操作 — 真实 MCP

  denied / 已拒绝:       Browser operations are disabled in project policy

  Diagnostic success is not visual acceptance evidence.
  诊断通过不等于视觉验收证据。
```

Resolve: add the `browser_operations:` opt-in block shown above to
`.roll/policy.yaml`, run `roll browser doctor --probe` to verify, then retry.

Failure modes and their remediation:

| Failure | Doctor signal | Fix |
|---------|--------------|-----|
| `chrome-devtools-mcp` not installed | `managed: degraded — transport not found` | `npm i -g chrome-devtools-mcp@<version>` or `roll browser setup --confirm` |
| Chrome binary not found | `managed: degraded — chrome not found` | Install Chrome (stable channel) |
| Policy disables managed lane | run → `denied` | Add the `browser_operations:` opt-in block (`enabled: true` + `managed.enabled: true` + origin allowlist) to `.roll/policy.yaml` |
| MCP handshake fails | `doctor --probe` → `manifest` failure | Check `chrome-devtools-mcp` version; re-run `roll browser update --check` |
| MCP process crashes mid-run | run → `devtools-error` | Re-run; consistent crashes → `roll browser doctor --probe` |
| Run timeout | run → `timeout` | Target may be slow; profile cleaned up regardless |

### Fixture Path (Test-Only)

A `--fixture` flag runs a **fake-target path** for testing seams and exploring
the lane's reporting without a real MCP process. It is **not** a managed lane
fallback — the fixture uses hardcoded test data and never proves the real MCP
transport works.

```bash
roll browser run --fixture --action screenshot
```

```
Managed browser operation — fixture (fake target)
受管浏览器操作 — fixture（假目标）

  lane / 通道:            managed (fixture — TEST ONLY / 仅测试)
  action / 动作:          screenshot
  target / 目标:          https://fake.target.test
  run state / 运行状态:   passed
  result / 结果:          pass (action: ok)
  temp profile / 临时档案: removed (owner state never entered / 绝不进入 owner 状态)
  diagnostics / 诊断产物:  1 (diagnostic-only, NOT visual acceptance / 仅诊断，非视觉验收)
  summary / 摘要:         diagnostic screenshot captured at https://fake.target.test

  Diagnostic success is not visual acceptance evidence.
  诊断通过不等于视觉验收证据。
```

The fixture supports injection flags for exploring failure modes:
`--fail timeout|crash|devtools-error`, `--redirect <url>`, `--perf-fail`.
These are test-only — they have no effect on the real MCP lane.

**A fixture run can never earn a `verified` verdict.** Only the real MCP lane
(no `--fixture` flag) exercises the actual transport. The live regression gate
(see below) enforces this at the CI level: a `fixture`-sourced report can
exercise seams but can never produce a `verified` result.

### Transport Updates

The DevTools transport version is **pinned**. `update --check` compares the
pinned version against a candidate without downloading or changing anything:

```bash
roll browser update --check
```

Applying an update is gated the same way as setup — it requires explicit
confirmation, runs a smoke check, then a **real MCP probe**, and keeps the
prior version intact on any failure:

```bash
roll browser update --apply --confirm
```

The update lifecycle:

1. **Check** — compare pinned version against the candidate.
2. **Smoke check** — validate the candidate binary starts.
3. **MCP probe** — `doctor --probe` runs against the candidate version.
   If the probe fails, the update is **aborted** and the prior version is
   kept intact.
4. **Apply** — only if smoke + probe both pass, the config is rewritten
   and the new version becomes the pinned transport.

```
Update applied: 1.5.0 → 1.6.0
更新已应用：1.5.0 → 1.6.0
  wrote: ~/.roll/browser-operations.yaml

  smoke check: passed
  冒烟检查：通过

  MCP probe: passed (1.6.0)
  MCP 探测：通过 (1.6.0)

✓ managed:     ready    chrome-devtools-mcp 1.6.0 (8 tools) — live probe passed
```

A failed update keeps the prior version:

```
Update aborted: live MCP probe failed for 1.6.0
更新中止：1.6.0 实时 MCP 探测失败

  Prior version 1.5.0 is kept intact.
  已保留原版本 1.5.0。

  transport: process exited before initialize completed
```

---

## Optional Diagnostic Profiles

The managed lane ships two **optional, opt-in** diagnostic profiles: a
performance profile and a small set of device-emulation profiles. Both run only
inside the managed isolated lane (real MCP path), and both produce
**diagnostic-only** material.

Read the boundary before adopting them:

- They are **opt-in**. Nothing collects a profile unless you explicitly select
  one on the command line; the baseline managed operation is unchanged when no
  profile is requested.
- Their output is **diagnostic-only**, never visual acceptance evidence and
  never a multi-browser test matrix. A profile summary proves a local diagnostic
  ran; it does not satisfy a story's visual AC. Use
  [Roll Capture](acceptance-evidence.md) for visual acceptance.
- They **minimize data** and send nothing off the machine.

### Performance Profile (opt-in)

`--perf-profile web-vitals-lite` collects a bounded, redacted set of local
DevTools performance counters (documents, frames, layout/style counts and
durations, script/task durations, JS heap size — a fixed allowlist of numeric
metrics). It is disabled unless you select it, and selecting it is what flips the
lane's performance-diagnostics policy on.

```bash
roll browser run --story US-BROW-021 --url https://example.test --perf-profile web-vitals-lite
```

```
  perf profile / 性能诊断: web-vitals-lite (opt-in, diagnostic-only / 需选启，仅诊断)
    metrics / 指标 (12, bounded & redacted / 有界脱敏):
      - LayoutCount: 3
      - ScriptDuration: 0.021
      ...
```

Data-minimization and scope guarantees:

- **Only numeric metric names in the profile allowlist survive.** No URL,
  resource name, or trace is ever retained, so the profile cannot become an
  analytics or evidence channel.
- **No external telemetry.** Nothing is uploaded to CrUX, Lighthouse, or any
  other service. Adding an external upload would require a separately designed,
  consent-gated policy contract.
- **Graceful degradation.** If collection fails, the run reports
  `degraded — no signal collected` and the underlying action verdict is
  unchanged.

An unknown profile name is denied fail-fast, not silently ignored.

### Device-Emulation Profiles (opt-in)

`--profile <name>` runs the managed operation under a named Chrome
device/viewport profile. The allowlist is finite — callers cannot submit
arbitrary DevTools emulation parameters:

| Profile | Viewport | Scale | Mobile |
|---------|----------|-------|--------|
| `Pixel 7` | 412 × 915 | 2.625 | yes |
| `iPhone 14` | 390 × 844 | 3 | yes |
| `iPad Pro` | 1024 × 1366 | 2 | no |

```bash
roll browser run --story US-BROW-021 --url https://example.test --action screenshot --profile "iPhone 14"
# device profile / 设备仿真: iPhone 14
```

Scope guarantees:

- **Finite allowlist only.** An unknown profile name is denied fail-fast; there
  is no way to pass raw emulation parameters through it.
- **This is Chrome DevTools emulation, not a multi-browser matrix.** Comparing
  declared viewport behavior is in scope; a real cross-browser (Playwright-style)
  farm is explicitly out of scope and would need a separately designed proposal.
- **Security invariants are unchanged.** A device profile does not alter origin
  policy, temporary-profile cleanup, Capture verdicts, or interactive
  owner-Chrome behavior.

---

## Interactive Lane

The interactive lane lets you run **one low-risk owner-Chrome operation** at a
time against a page you already have open in your own Chrome. It is designed
for manual attest workflows, not background automation.

### What you must set up first

Roll **does not start Chrome for you** and **does not enable remote debugging**.
You must launch your own Chrome with a loopback debug endpoint before running
`roll browser interactive`:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/owner-chrome-profile
```

Only `127.0.0.1:9222` (or another loopback address) is allowed. Non-loopback
endpoints are rejected.

### Run an interactive operation

```bash
roll browser interactive \
  --story US-EXAMPLE-001 \
  --origin https://example.test \
  --action navigate --url https://example.test/login
```

Supported actions: `navigate`, `click`, `fill`, `press_key`.

The command requires an **attached TTY**. It prints exactly what it will do,
including the story, origin, action, and a 15-minute maximum lease, then asks
for **one owner approval**:

```
Owner Chrome approval required (one operation only)
  story: US-EXAMPLE-001
  origin: https://example.test
  action: navigate to https://example.test
  expiry: 2026-07-15T08:34:00.000Z (15 minutes maximum)
  credential export: denied (cookies, storage, and network bodies are unavailable)
Approve this owner-run operation? [y/N]
```

If you decline, no connection is attempted. If you approve, Roll connects to
the local debug endpoint, executes the single operation, prints the result,
and releases the lease immediately:

```
manual owner-run result: ok (tab: 1234)
This interactive result does not make CI pass and is not background automation.
```

### Lease expiry and cancellation

Each interactive operation holds a lease for **at most 15 minutes**. The lease
is bound to the holder process and the loopback endpoint; it is released as
soon as the operation finishes. If the process dies or the lease expires, Roll
reclaims it automatically. You cannot approve a persistent background lease —
every operation needs its own foreground approval.

### What the interactive lane will never do

- Run without an attached TTY and explicit owner approval.
- Connect to a non-loopback or remote debug endpoint.
- Export cookies, storage, network bodies, or any other credentials.
- Start Chrome automatically or leave a background scheduler running.
- Make CI pass on its own — it is an **owner-run manual-attest** tool only.

---

## Evidence Boundary

Managed browser diagnostics and interactive owner-run results are
**diagnostic-only / manual-attest only**. Every run report repeats it:
*diagnostic success is not visual acceptance evidence*. A diagnostic screenshot
or interactive result is classified as a diagnostic artifact, not a visual-AC
artifact, so it can never fake a story's visual acceptance. When a story needs
visual acceptance, use **Roll Capture** — a physical screenshot of your real
terminal/app — which alone satisfies that requirement. See
[Acceptance evidence](acceptance-evidence.md).

When `roll attest` receives a physical capture response, it writes a validated
CaptureBridge link to `.roll/browser-operations/events.ndjson`. Doctor, truth,
and dossier surfaces read that durable fact: a verified `roll.capture.v1`
physical capture can satisfy a visual AC, while Playwright and DevTools
diagnostics remain ineligible. With no persisted link, capture truth stays
honestly unknown and the dossier does not invent a capture event.

---

## Dossier Timeline (optional)

When a story has declared browser-operation facts (ledger start/finish, lease
grant/expiry/release, or physical-capture results), the delivery dossier shows a
compact **Browser operations timeline** under Execution. Ordering comes only from
declared timestamps — missing categories render as honest absences with reasons,
never an invented stamp or verdict. Redacted diagnostic artifacts and physical
capture images are linked only when the viewer is authorized under existing
dossier rules (local href map); otherwise the label stays visible without a
link. Stories with no browser facts keep the previous dossier shape unchanged.

**Unknown and degraded states are shown honestly.** When a category has no
declared timestamp, the timeline renders it as an explicit absence with the
reason (for example, *lease: unknown — no grant recorded*) rather than inventing
a stamp or a verdict. A profile that degraded (see
[Performance profile](#optional-diagnostic-profiles) above) appears as a
degraded diagnostic, not a pass. If a timeline row looks unexpectedly empty or
degraded, follow [Troubleshooting](#troubleshooting) below — a degraded managed
lane is a missing prerequisite, not a broken delivery.

---

## Safe Recovery

- If `doctor` reports `managed: degraded`, existing Playwright and Roll Capture
  paths remain usable — nothing you already rely on is broken. Install the
  missing dependency and re-run `roll browser doctor --probe`.
- The temporary profile is always removed after a run; owner Chrome state is
  never entered. If a run is interrupted, re-running is safe — each run starts
  from a fresh profile.
- Nothing is written to your product repo. The only file Roll may write is the
  machine-level `~/.roll/browser-operations.yaml`, and only with `--confirm`.

---

## Troubleshooting

### `roll browser doctor` reports `managed: degraded`

The static doctor found a missing prerequisite. Run `roll browser setup --dry-run`
to see what's needed, then install the missing dependency and re-run
`roll browser doctor --probe` to validate.

### `doctor --probe` fails with "transport" or "manifest" errors

The real MCP sidecar could not initialize. Common causes:

- `chrome-devtools-mcp` is not installed globally (`npm i -g chrome-devtools-mcp`).
- The version pinned in `~/.roll/browser-operations.yaml` does not match the
  installed version. Run `roll browser update --check` to compare.
- Chrome is not installed or not on PATH.

### `roll browser run` says "managed lane is disabled by project policy"

The project's `.roll/policy.yaml` does not enable the managed lane. Add:

```yaml
browser:
  managed:
    lane: enabled
```

Then re-run `roll browser doctor --probe` to verify the lane is ready.

### `roll browser run` without `--story` or `--url` fails

The real MCP lane **requires** `--story <US-ID>` and `--url <targetUrl>`. These
are recorded in the operation ledger for auditability. Omit them only with
`--fixture` (test-only path).

### `roll browser interactive` says "requires an attached TTY"

Interactive owner-Chrome operations require a foreground terminal. They cannot
run from a background scheduler, CI job, or non-interactive shell. This is by
design: every operation needs live owner approval.

### "Connects only to an already-open loopback Chrome debug endpoint"

Roll does not start Chrome and does not open a remote debug port. Launch Chrome
yourself with `--remote-debugging-port=9222` bound to `127.0.0.1`. Non-loopback
addresses are rejected.

### Can I use interactive mode to export cookies or keep a session open?

No. Credential export (cookies, storage, and network bodies) is always denied.
The lease is released immediately after the operation and expires within 15
minutes; there is no background scheduler or persistent session.

### Can I point interactive mode at a remote Chrome instance?

No. Only loopback endpoints are supported. There is no remote endpoint, tunnel,
or cloud browser integration.

---

## Live Regression Gate

The managed lane is protected by a real, hermetic end-to-end gate
(`pnpm test:browser-live`). It starts a local temporary HTTP target, a real
exact-version `chrome-devtools-mcp` process, and a managed temporary Chrome
profile, then drives navigation, DOM snapshot, real console/network summaries, a
diagnostic screenshot, and the opt-in performance/device profiles through the
public managed path (`roll browser run` without `--fixture`). It also proves
final-origin redirect denial and that timeout, Chrome crash, MCP protocol error,
and redaction failure each clean up the MCP process, Chrome, and the temporary
profile. It performs **no external network request**.

Two environments, deliberately separate:

- **Default `roll test` / `pnpm -r test`** — never runs the live gate (it needs
  Chrome). These suites stay green everywhere. The gate's own logic (capability
  detection, evidence scoring, the local target) is covered by hermetic unit
  tests that always run.
- **Chrome-capable CI lane** (`.github/workflows/browser-live-gate.yml`) — sets
  `ROLL_BROWSER_LIVE=1`, provisions a real Chrome, and runs the live gate for
  real.

The gate is **fail-loud, never a silent skip**. Run it locally with:

```bash
ROLL_BROWSER_LIVE=1 pnpm test:browser-live
```

If Chrome or `npx` is missing, or `ROLL_BROWSER_LIVE` is unset, the gate exits
as an *explicitly unavailable environment gate* — it reports the missing
capability and states plainly that the managed lane is **not verified**. It
never reports the feature as verified from a skipped or fixture run: a
`fixture`-sourced report can exercise seams but can never earn a `verified`
verdict.

A `verified` result prints the real transport verification (`transport
initialized`, `manifest verified`), the per-scenario cleanup state, and the
diagnostic-only boundary — the same summary a physical-terminal screenshot
captures.

---

## See Also

- [Tools & policy](tools.md) — how `browser.*` tool access is governed.
- [Acceptance evidence](acceptance-evidence.md) — why diagnostics are not visual AC.
- [FAQ](faq.md) — common questions and answers.
- [中文版](../zh/browser-operations.md)
