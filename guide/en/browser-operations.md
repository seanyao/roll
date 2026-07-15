# Roll — Browser Operations (managed + interactive lanes)

Roll can drive a **managed, isolated Chrome via the DevTools transport** to
collect browser diagnostics — navigation checks, DOM snapshots, console and
network capture, and diagnostic screenshots. It also supports a single
**interactive owner-Chrome operation** against an already-open localhost debug
endpoint, with foreground owner approval and strict lease controls.

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

This page documents the managed lane and the interactive lane that ship today.

## Managed

The managed lane launches Chrome under a **fresh temporary profile**, runs one
operation against an allowlisted target, and removes the profile afterwards.
Owner browser state (cookies, logins, history) is never entered.

### Prerequisites

The managed lane needs the pinned `chrome-devtools-mcp` transport and a Chrome
binary. Roll does not install these for you — it reports what is missing and
how to fix it. Run the doctor first:

```bash
roll browser doctor
```

```
Browser operations doctor
浏览器操作体检

~ managed:     degraded unavailable — chrome-devtools-mcp not ready; existing Playwright and Roll Capture paths remain usable
    → roll browser setup --dry-run
    → install the missing dependency, then re-run roll browser doctor
✓ interactive: ready    owner Chrome reachable on 127.0.0.1:9222
~ capture:     degraded skipped — Roll Capture readiness probe skipped (headless / CI / ROLL_NO_SCREENCAP).
    → roll doctor --tools
    → see Roll Capture.app setup guidance
```

Each lane reports one of three honest states:

| State | Meaning |
|-------|---------|
| `ready` | The lane's prerequisites are satisfied. |
| `degraded` | The lane is unavailable or partially available. Existing Playwright and Roll Capture paths keep working — a missing prerequisite is never reported as a pass. |
| `blocked` | A hard precondition prevents the lane from running; the reason and repair command are printed. |

The human-readable doctor also includes a **Browser operations facts** section
from this project's `.roll/browser-operations/events.ndjson` ledger. It reports
an interactive lease as `ready` after a recorded grant, `expired` after expiry,
and `degraded` when the owner holder was reclaimed as orphaned. With no lease
fact it remains `unknown`; environment readiness is never used to invent a
lease result.

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

### Running a managed operation

`roll browser run` executes one managed-lane operation against a fake target and
prints an operator-observable result. Use it to see the lane's behaviour without
a real site:

```bash
roll browser run --action screenshot
```

```
Managed browser operation — fixture (fake target)
受管浏览器操作 — fixture（假目标）

  lane / 通道:            managed
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

Supported actions: `navigate` (default), `snapshot`, `console`, `network`,
`screenshot`. A target outside the allowlist — including a redirect away from
the requested origin — is **denied**, not followed:

```bash
roll browser run --redirect https://evil.test
# run state: denied — Origin not in allowlist
```

Failures are categorized, never silent: `--fail timeout|crash|devtools-error`
injects each class so you can see how the lane reports it.

### Transport updates

The DevTools transport version is pinned. `update --check` compares the pinned
version against a candidate without downloading or changing anything:

```bash
roll browser update --check
```

Applying an update is gated the same way as setup — it requires explicit
confirmation, runs smoke checks plus the doctor, and keeps the prior version
intact on failure:

```bash
roll browser update --apply --confirm
```

## Optional diagnostic profiles

The managed lane ships two **optional, opt-in** diagnostic profiles: a
performance profile and a small set of device-emulation profiles. Both run only
inside the managed isolated lane, and both produce **diagnostic-only** material.

Read the boundary before adopting them:

- They are **opt-in**. Nothing collects a profile unless you explicitly select
  one on the command line; the baseline managed operation is unchanged when no
  profile is requested.
- Their output is **diagnostic-only**, never visual acceptance evidence and
  never a multi-browser test matrix. A profile summary proves a local diagnostic
  ran; it does not satisfy a story's visual AC. Use
  [Roll Capture](acceptance-evidence.md) for visual acceptance.
- They **minimize data** and send nothing off the machine.

### Performance profile (opt-in)

`--perf-profile web-vitals-lite` collects a bounded, redacted set of local
DevTools performance counters (documents, frames, layout/style counts and
durations, script/task durations, JS heap size — a fixed allowlist of numeric
metrics). It is disabled unless you select it, and selecting it is what flips the
lane's performance-diagnostics policy on.

```bash
roll browser run --action navigate --perf-profile web-vitals-lite
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
  unchanged. `--perf-fail` simulates this so you can see it:

```bash
roll browser run --action navigate --perf-profile web-vitals-lite --perf-fail
# perf profile: web-vitals-lite → degraded — no signal collected (action verdict unchanged)
```

An unknown profile name is denied fail-fast, not silently ignored.

### Device-emulation profiles (opt-in)

`--profile <name>` runs the managed operation under a named Chrome
device/viewport profile. The allowlist is finite — callers cannot submit
arbitrary DevTools emulation parameters:

| Profile | Viewport | Scale | Mobile |
|---------|----------|-------|--------|
| `Pixel 7` | 412 × 915 | 2.625 | yes |
| `iPhone 14` | 390 × 844 | 3 | yes |
| `iPad Pro` | 1024 × 1366 | 2 | no |

```bash
roll browser run --action screenshot --profile "iPhone 14"
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

## Interactive

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

## Evidence boundary

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

## Dossier timeline (optional)

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

## Safe recovery

- If `doctor` reports `managed: degraded`, existing Playwright and Roll Capture
  paths remain usable — nothing you already rely on is broken. Install the
  missing dependency and re-run `roll browser doctor`.
- The temporary profile is always removed after a run; owner Chrome state is
  never entered. If a run is interrupted, re-running is safe — each run starts
  from a fresh profile.
- Nothing is written to your product repo. The only file Roll may write is the
  machine-level `~/.roll/browser-operations.yaml`, and only with `--confirm`.

## Troubleshooting

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

## Live regression gate

The managed lane is protected by a real, hermetic end-to-end gate
(`pnpm test:browser-live`). It starts a local temporary HTTP target, a real
exact-version `chrome-devtools-mcp` process, and a managed temporary Chrome
profile, then drives navigation, DOM snapshot, real console/network summaries, a
diagnostic screenshot, and the opt-in performance/device profiles through the
public managed path. It also proves final-origin redirect denial and that
timeout, Chrome crash, MCP protocol error, and redaction failure each clean up
the MCP process, Chrome, and the temporary profile. It performs **no external
network request**.

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

## See also

- [Tools & policy](tools.md) — how `browser.*` tool access is governed.
- [Acceptance evidence](acceptance-evidence.md) — why diagnostics are not visual AC.
- [中文版](../zh/browser-operations.md)
