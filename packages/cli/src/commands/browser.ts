/**
 * US-BROW-003 — `roll browser setup` / `roll browser doctor`.
 * US-BROW-010 — `roll browser update` — check and approve DevTools transport updates.
 *
 * Hard invariants:
 *  - `setup --dry-run` reports the proposed machine config and dependency
 *    preflight WITHOUT writing anything.
 *  - `setup` writes ~/.roll/browser-operations.yaml ONLY with explicit owner
 *    confirmation (`--confirm`). It never touches a product repo package.json
 *    and never enables owner Chrome remote debugging.
 *  - `doctor [--json]` independently reports managed / interactive / capture as
 *    ready | degraded | blocked, with actionable reasons. Missing prerequisites
 *    are honest — never a false pass — and leave Playwright / Roll Capture usable.
 *  - `update --check` reports pinned vs candidate version without downloading,
 *    installing, or rewriting any configuration.
 *  - `update --apply` requires explicit `--confirm`; runs smoke checks + doctor;
 *    on failure keeps the prior version intact.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  BrowserLeaseService,
  BrowserTransportVersion,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
  pinnedDevToolsVersionSource,
  resolveDeviceProfile,
  type VersionSource,
} from "@roll/core";
import {
  createLoopbackOwnerChromeAdapter,
  proposedBrowserOperationsConfig,
  type InteractiveLowRiskAction,
  type InteractiveOperationResult,
} from "@roll/infra";
import type { BrowserActionKind, BrowserTransportVersionCheck } from "@roll/spec";
import { randomUUID } from "node:crypto";
import { collectBrowserEnvironmentReadiness, renderBrowserDoctor } from "../lib/browser-readiness-doctor.js";
import type { ManagedFixtureFailure } from "@roll/infra";
import {
  MANAGED_FIXTURE_ACTIONS,
  renderManagedRunReport,
  runManagedFixtureOperation,
} from "../lib/managed-browser-run.js";

export interface BrowserCommandDeps {
  /** Resolve the machine-level config path (never a product repo file). */
  configPath: () => string;
  writeFile: (path: string, content: string) => void;
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  /** Deterministic, injectable version source for update check/apply. */
  versionSource?: VersionSource;
  /** Smoke/contract check — runs before an update is applied. */
  smokeCheck?: () => Promise<boolean>;
  readiness?: () => ReturnType<typeof collectBrowserEnvironmentReadiness>;
  /** Terminal gate and confirmation seam for owner Chrome operations. */
  isTTY: () => boolean;
  readApproval: (prompt: string) => Promise<boolean>;
  interactiveRun: (input: InteractiveBrowserRunInput) => Promise<InteractiveOperationResult>;
  stdout: (text: string) => void;
}

export interface InteractiveBrowserRunInput {
  storyId: string;
  origin: string;
  endpoint: string;
  action: InteractiveLowRiskAction;
  actionSummary: string;
}

function defaultDeps(): BrowserCommandDeps {
  return {
    configPath: () => process.env["ROLL_BROWSER_OPERATIONS_CONFIG"] ?? join(homedir(), ".roll", "browser-operations.yaml"),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    readFile: (path) => readFileSync(path, "utf8"),
    fileExists: (path) => existsSync(path),
    smokeCheck: async () => true,
    isTTY: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
    readApproval: readOwnerApproval,
    interactiveRun: defaultInteractiveRun,
    stdout: (text) => process.stdout.write(text),
  };
}

const USAGE =
  "Usage: roll browser <setup|doctor|run|interactive|update>\n" +
  "  setup --dry-run       Report proposed machine config + dependency preflight (writes nothing).\n" +
  "  setup --confirm       Write ~/.roll/browser-operations.yaml after explicit owner confirmation.\n" +
  "  doctor [--json]       Report managed / interactive / capture readiness (ready|degraded|blocked).\n" +
  "  run [opts]            Run a managed-lane operation against a fake target and print the result.\n" +
  "     --action <navigate|snapshot|console|network|screenshot>  (default: navigate)\n" +
  "     --url <fakeUrl>    Fake target URL (default: https://fake.target.test).\n" +
  "     --selector <sel>   DOM selector for --action snapshot.\n" +
  "     --redirect <url>   Simulate a redirect (proves redirect denial).\n" +
  "     --fail <timeout|crash|devtools-error>  Inject a categorized diagnostic failure.\n" +
  "     --profile <name>   Device emulation profile (Pixel 7, iPhone 14, iPad Pro).\n" +
  "     --json             Emit the machine-readable run report.\n" +
  "  interactive --story <US-ID> --origin <https-origin> --action <navigate|click|fill|press_key> [action flags]\n" +
  "     Requires an attached TTY and one owner approval. Connects only to an already-open loopback Chrome debug endpoint.\n" +
  "     --endpoint <http://127.0.0.1:9222> (default); navigate: --url; click: --selector; fill: --selector --value; press_key: --key.\n" +
  "  update [--check] [--json]   Check for DevTools transport update (pinned vs candidate).\n" +
  "  update --apply --confirm    Apply update after smoke checks + doctor.\n";

function readiness(deps: BrowserCommandDeps): ReturnType<typeof collectBrowserEnvironmentReadiness> {
  return deps.readiness?.() ?? collectBrowserEnvironmentReadiness();
}

function setupCommand(args: string[], deps: BrowserCommandDeps): number {
  const dryRun = args.includes("--dry-run");
  const confirmed = args.includes("--confirm") || args.includes("--yes");
  const cfgPath = deps.configPath();
  const proposed = proposedBrowserOperationsConfig();
  const r = readiness(deps);

  const preflight = [
    "Browser operations setup",
    "浏览器操作安装",
    "",
    `  target (machine-level, never committed): ${cfgPath}`,
    "",
    "  proposed ~/.roll/browser-operations.yaml:",
    ...proposed.split("\n").map((line: string) => (line === "" ? "" : `    ${line}`)),
    "  dependency preflight:",
    ...renderBrowserDoctor(r).map((line) => `    ${line}`),
    "",
    "  Roll never installs into a product package.json and never enables owner Chrome remote debugging.",
    "  Roll 绝不改动产品仓 package.json，也绝不自动开启 owner Chrome 的远程调试。",
    "",
  ];

  if (dryRun) {
    deps.stdout([...preflight, "  dry-run: no configuration was written.", ""].join("\n") + "\n");
    return 0;
  }

  if (!confirmed) {
    deps.stdout(
      [
        ...preflight,
        "  refused: writing the machine config requires explicit owner confirmation.",
        "  已拒绝：写入机器级配置需要 owner 显式确认。",
        "  Re-run with --confirm to write, or --dry-run to preview only.",
        "",
      ].join("\n") + "\n",
    );
    return 0;
  }

  deps.writeFile(cfgPath, proposed);
  deps.stdout(
    [...preflight, `  confirmed: wrote ${cfgPath}`, "  已确认：配置已写入。", ""].join("\n") + "\n",
  );
  return 0;
}

function doctorSubcommand(args: string[], deps: BrowserCommandDeps): number {
  const r = readiness(deps);
  if (args.includes("--json")) {
    deps.stdout(JSON.stringify(r, null, 2) + "\n");
    return 0;
  }
  deps.stdout(["Browser operations doctor", "浏览器操作体检", "", ...renderBrowserDoctor(r), ""].join("\n") + "\n");
  return 0;
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const FAILURE_KINDS: readonly ManagedFixtureFailure[] = ["timeout", "crash", "devtools-error"];

async function runSubcommand(args: string[], deps: BrowserCommandDeps): Promise<number> {
  const actionArg = (flagValue(args, "--action") ?? "navigate") as BrowserActionKind;
  if (!MANAGED_FIXTURE_ACTIONS.includes(actionArg)) {
    process.stderr.write(
      `roll browser run: unsupported --action '${actionArg}'. Supported: ${MANAGED_FIXTURE_ACTIONS.join(", ")}.\n`,
    );
    return 1;
  }
  const failArg = flagValue(args, "--fail");
  if (failArg !== undefined && !FAILURE_KINDS.includes(failArg as ManagedFixtureFailure)) {
    process.stderr.write(`roll browser run: unknown --fail '${failArg}'. Supported: ${FAILURE_KINDS.join(", ")}.\n`);
    return 1;
  }

  // Validate device profile early (US-BROW-014): fail-fast with clear error.
  const profileArg = flagValue(args, "--profile");
  if (profileArg !== undefined) {
    const resolved = resolveDeviceProfile(profileArg);
    if ("code" in resolved) {
      process.stderr.write(`roll browser run: ${resolved.message}\n`);
      return 1;
    }
  }

  const report = await runManagedFixtureOperation({
    action: actionArg,
    targetUrl: flagValue(args, "--url") ?? "https://fake.target.test",
    selector: flagValue(args, "--selector"),
    redirectTo: flagValue(args, "--redirect"),
    failure: failArg as ManagedFixtureFailure | undefined,
    deviceProfile: profileArg,
  });

  if (args.includes("--json")) {
    deps.stdout(JSON.stringify(report, null, 2) + "\n");
  } else {
    deps.stdout(renderManagedRunReport(report).join("\n") + "\n");
  }
  // The fixture surface always exits 0: a categorized failure/denial is a
  // successfully-observed diagnostic outcome, not a CLI error.
  return 0;
}

async function interactiveSubcommand(args: string[], deps: BrowserCommandDeps): Promise<number> {
  if (!deps.isTTY()) {
    deps.stdout("roll browser interactive requires an attached TTY; no owner Chrome connection was attempted.\n");
    return 1;
  }
  const storyId = flagValue(args, "--story");
  const origin = flagValue(args, "--origin");
  if (storyId === undefined || origin === undefined) {
    deps.stdout("roll browser interactive requires --story <US-ID> and --origin <https-origin>.\n");
    return 1;
  }
  const action = interactiveAction(args);
  if (action === undefined) {
    deps.stdout("roll browser interactive requires a supported typed --action and its required flags.\n");
    return 1;
  }
  const endpoint = flagValue(args, "--endpoint") ?? "http://127.0.0.1:9222";
  const actionSummary = interactiveActionSummary(action);
  const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const prompt = [
    "Owner Chrome approval required (one operation only)",
    `  story: ${storyId}`,
    `  origin: ${origin}`,
    `  action: ${actionSummary}`,
    `  expiry: ${expiry} (15 minutes maximum)`,
    "  credential export: denied (cookies, storage, and network bodies are unavailable)",
    "Approve this owner-run operation? [y/N] ",
  ].join("\n");
  if (!(await deps.readApproval(prompt))) {
    deps.stdout("Owner declined the interactive operation; no owner Chrome connection was attempted.\n");
    return 1;
  }
  const outcome = await deps.interactiveRun({ storyId, origin, endpoint, action, actionSummary });
  if (outcome.kind === "denied") {
    deps.stdout(`Interactive operation denied: ${outcome.reason.code} — ${outcome.reason.message}\n`);
    return 1;
  }
  deps.stdout(
    `manual owner-run result: ${outcome.result.status} (tab: ${outcome.tabId})\n` +
    "This interactive result does not make CI pass and is not background automation.\n",
  );
  return 0;
}

function interactiveAction(args: string[]): InteractiveLowRiskAction | undefined {
  switch (flagValue(args, "--action")) {
    case "navigate": {
      const url = flagValue(args, "--url");
      return url === undefined ? undefined : { kind: "navigate", url };
    }
    case "click": {
      const selector = flagValue(args, "--selector");
      return selector === undefined ? undefined : { kind: "click", selector };
    }
    case "fill": {
      const selector = flagValue(args, "--selector");
      const value = flagValue(args, "--value");
      return selector === undefined || value === undefined ? undefined : { kind: "fill", selector, value };
    }
    case "press_key": {
      const key = flagValue(args, "--key");
      return key === undefined ? undefined : { kind: "press_key", key };
    }
    default:
      return undefined;
  }
}

function interactiveActionSummary(action: InteractiveLowRiskAction): string {
  switch (action.kind) {
    case "navigate": return `navigate to ${new URL(action.url).origin}`;
    case "click": return `click ${action.selector}`;
    case "fill": return `fill ${action.selector}`;
    case "press_key": return `press ${action.key}`;
  }
}

async function defaultInteractiveRun(input: InteractiveBrowserRunInput): Promise<InteractiveOperationResult> {
  const holderToken = randomUUID();
  const service = new BrowserLeaseService(join(process.cwd(), ".roll", "browser-operations", "leases"));
  service.releaseIfExpired(input.endpoint);
  service.reclaimDeadHolder(input.endpoint);
  const granted = service.grant({
    approval: {
      storyId: input.storyId,
      origin: input.endpoint,
      actionSummary: input.actionSummary,
      requestedMs: 15 * 60 * 1000,
      credentialExportDenied: true,
    },
    holderPid: process.pid,
    holderToken,
    operator: process.env["USER"] ?? "owner",
    callerTty: true,
    callerIsScheduler: false,
  });
  if (granted.kind === "denied") return { kind: "denied", reason: granted.reason, ciPassed: false };
  try {
    return await createLoopbackOwnerChromeAdapter(input.endpoint).execute({ lease: granted.lease, origin: input.origin, action: input.action });
  } finally {
    service.release(granted.lease, holderToken);
  }
}

async function readOwnerApproval(prompt: string): Promise<boolean> {
  const readline = await import("node:readline/promises");
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(prompt)).trim().toLowerCase() === "y";
  } finally {
    terminal.close();
  }
}

function readPinnedVersion(configPath: string, deps: BrowserCommandDeps): string {
  if (!deps.fileExists(configPath)) {
    return MANAGED_DEVTOOLS_PACKAGE_VERSION;
  }
  const cfg = deps.readFile(configPath);
  const m = /package_version:\s*(\S+)/.exec(cfg);
  return m?.[1] ?? MANAGED_DEVTOOLS_PACKAGE_VERSION;
}

function updateProposedConfig(pinned: string): string {
  return proposedBrowserOperationsConfig().replace(
    `package_version: ${MANAGED_DEVTOOLS_PACKAGE_VERSION}`,
    `package_version: ${pinned}`,
  );
}

function updateCheckCommand(args: string[], deps: BrowserCommandDeps): number {
  const json = args.includes("--json");
  const cfgPath = deps.configPath();
  const pinned = readPinnedVersion(cfgPath, deps);
  const vs = deps.versionSource ?? pinnedDevToolsVersionSource(pinned);
  const version = new BrowserTransportVersion(pinned, vs);
  const result = version.check();

  if (json) {
    deps.stdout(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  const lines = [
    "DevTools transport update check",
    "DevTools 传输更新检查",
    "",
    `  pinned:    ${result.pinned}`,
    `  candidate: ${result.candidate ?? "(none)"}`,
    "",
  ];
  if (result.updateAvailable) {
    lines.push(
      `  Update available: ${result.pinned} → ${result.candidate}`,
      `  有可用更新：${result.pinned} → ${result.candidate}`,
      "",
      "  Run `roll browser update --apply --confirm` to apply after approval.",
      "  运行 `roll browser update --apply --confirm` 经确认后应用。",
    );
  } else {
    lines.push(
      `  Already up to date at ${result.pinned}.`,
      `  已是最新版本 ${result.pinned}。`,
    );
  }
  lines.push("");
  deps.stdout(lines.join("\n") + "\n");
  return 0;
}

async function updateApplyCommand(args: string[], deps: BrowserCommandDeps): Promise<number> {
  const confirmed = args.includes("--confirm") || args.includes("--yes");
  const cfgPath = deps.configPath();
  const pinned = readPinnedVersion(cfgPath, deps);
  const vs = deps.versionSource ?? pinnedDevToolsVersionSource(pinned);
  const version = new BrowserTransportVersion(pinned, vs);

  if (!confirmed) {
    const check = version.check();
    deps.stdout(
      [
        "DevTools transport update apply",
        "DevTools 传输更新应用",
        "",
        `  pinned:    ${check.pinned}`,
        `  candidate: ${check.candidate ?? "(none)"}`,
        "",
        "  refused: applying an update requires explicit owner confirmation.",
        "  已拒绝：应用更新需要 owner 显式确认。",
        "  Re-run with --apply --confirm to apply.",
        "",
      ].join("\n") + "\n",
    );
    return 0;
  }

  const candidate = version.check().candidate;
  if (candidate === null) {
    deps.stdout(
      [
        `Already up to date at ${pinned}. Nothing to apply.`,
        `已是最新版本 ${pinned}，无需更新。`,
        "",
      ].join("\n") + "\n",
    );
    return 0;
  }

  if (deps.smokeCheck === undefined) {
    deps.stdout("error: smoke check is not available (headless / CI)\n");
    return 1;
  }

  // Run browser doctor alongside smoke/contract checks (US-BROW-010 AC3).
  const doctorResult = readiness(deps);

  const result = await version.apply(candidate, deps.smokeCheck);

  if (result.kind === "applied") {
    const newCfg = updateProposedConfig(result.to);
    deps.writeFile(cfgPath, newCfg);
    const doctorLines = renderBrowserDoctor(doctorResult);
    deps.stdout(
      [
        `Update applied: ${result.from} → ${result.to}`,
        `更新已应用：${result.from} → ${result.to}`,
        `  wrote: ${cfgPath}`,
        "",
        `  smoke check: passed`,
        `  冒烟检查：通过`,
        "",
        `  browser doctor:`,
        `  浏览器体检：`,
        ...doctorLines.map((l) => `    ${l}`),
        "",
      ].join("\n") + "\n",
    );
    return 0;
  }

  if (result.kind === "verification_failed") {
    const doctorLines = renderBrowserDoctor(doctorResult);
    deps.stdout(
      [
        `Update verification failed: ${result.from} → ${result.candidate}`,
        `更新验证失败：${result.from} → ${result.candidate}`,
        `  reason: ${result.reason}`,
        `  原因：${result.reason}`,
        "",
        `  Prior version ${result.from} is kept intact.`,
        `  已保留原版本 ${result.from}。`,
        "",
        `  browser doctor:`,
        `  浏览器体检：`,
        ...doctorLines.map((l) => `    ${l}`),
        "",
      ].join("\n") + "\n",
    );
    return 1;
  }

  deps.stdout(`Update refused: ${result.kind === "no_update" ? "already at this version" : result.reason}\n`);
  return 0;
}

export async function browserCommand(args: string[], depsOverride?: Partial<BrowserCommandDeps>): Promise<number> {
  const deps = { ...defaultDeps(), ...depsOverride };
  const sub = args[0];
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    deps.stdout(USAGE);
    return 0;
  }
  if (sub === "setup") return setupCommand(args.slice(1), deps);
  if (sub === "doctor") return doctorSubcommand(args.slice(1), deps);
  if (sub === "run") return runSubcommand(args.slice(1), deps);
  if (sub === "interactive") return interactiveSubcommand(args.slice(1), deps);
  if (sub === "update") return updateSubcommand(args.slice(1), deps);
  process.stderr.write(`roll browser: unknown subcommand '${sub}'\n\n${USAGE}`);
  return 1;
}

function updateSubcommand(args: string[], deps: BrowserCommandDeps): number | Promise<number> {
  // Default to --check when no flags
  if (args.length === 0 || args.includes("--check")) {
    return updateCheckCommand(args, deps);
  }
  if (args.includes("--apply")) {
    return updateApplyCommand(args, deps);
  }
  return updateCheckCommand(args, deps);
}
