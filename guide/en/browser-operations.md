# Roll — Browser Operations (managed lane)

Roll can drive a **managed, isolated Chrome via the DevTools transport** to
collect browser diagnostics — navigation checks, DOM snapshots, console and
network capture, and diagnostic screenshots. This is the first user-visible
slice of browser operations. It is opt-in, dependency-gated, and deliberately
narrow.

Two things it is **not**:

- It is **not** an installer. Roll never adds a dependency to your product
  repo's `package.json`, and never enables remote debugging on your own
  (owner) Chrome. Setup only writes a machine-level config after you confirm.
- Its output is **not** visual acceptance evidence. A managed diagnostic
  screenshot proves the page loaded; it does not satisfy a story's visual AC.
  Only **Roll Capture** (a physical screenshot of your real terminal/app)
  satisfies visual acceptance — see
  [Acceptance evidence](acceptance-evidence.md).

> The interactive owner-Chrome lane is a later slice and is **not** described
> here as available. This page documents only the managed lane that ships today.

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

## Evidence boundary

Managed browser diagnostics are **diagnostic-only**. Every run report repeats
it: *diagnostic success is not visual acceptance evidence*. A diagnostic
screenshot is classified as a diagnostic artifact, not a visual-AC artifact, so
it can never fake a story's visual acceptance. When a story needs visual
acceptance, use **Roll Capture** — a physical screenshot of your real
terminal/app — which alone satisfies that requirement. See
[Acceptance evidence](acceptance-evidence.md).

## Dossier timeline (optional)

When a story has declared browser-operation facts (ledger start/finish, lease
grant/expiry/release, or physical-capture results), the delivery dossier shows a
compact **Browser operations timeline** under Execution. Ordering comes only from
declared timestamps — missing categories render as honest absences with reasons,
never an invented stamp or verdict. Redacted diagnostic artifacts and physical
capture images are linked only when the viewer is authorized under existing
dossier rules (local href map); otherwise the label stays visible without a
link. Stories with no browser facts keep the previous dossier shape unchanged.

## Safe recovery

- If `doctor` reports `managed: degraded`, existing Playwright and Roll Capture
  paths remain usable — nothing you already rely on is broken. Install the
  missing dependency and re-run `roll browser doctor`.
- The temporary profile is always removed after a run; owner Chrome state is
  never entered. If a run is interrupted, re-running is safe — each run starts
  from a fresh profile.
- Nothing is written to your product repo. The only file Roll may write is the
  machine-level `~/.roll/browser-operations.yaml`, and only with `--confirm`.

## See also

- [Tools & policy](tools.md) — how `browser.*` tool access is governed.
- [Acceptance evidence](acceptance-evidence.md) — why diagnostics are not visual AC.
- [中文版](../zh/browser-operations.md)
