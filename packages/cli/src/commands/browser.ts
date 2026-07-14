/**
 * US-BROW-003 — `roll browser setup` / `roll browser doctor`.
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
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { proposedBrowserOperationsConfig } from "@roll/infra";
import type { BrowserActionKind } from "@roll/spec";
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
  fileExists: (path: string) => boolean;
  readiness?: () => ReturnType<typeof collectBrowserEnvironmentReadiness>;
  stdout: (text: string) => void;
}

function defaultDeps(): BrowserCommandDeps {
  return {
    configPath: () => process.env["ROLL_BROWSER_OPERATIONS_CONFIG"] ?? join(homedir(), ".roll", "browser-operations.yaml"),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    fileExists: (path) => existsSync(path),
    stdout: (text) => process.stdout.write(text),
  };
}

const USAGE =
  "Usage: roll browser <setup|doctor|run>\n" +
  "  setup --dry-run       Report proposed machine config + dependency preflight (writes nothing).\n" +
  "  setup --confirm       Write ~/.roll/browser-operations.yaml after explicit owner confirmation.\n" +
  "  doctor [--json]       Report managed / interactive / capture readiness (ready|degraded|blocked).\n" +
  "  run [opts]            Run a managed-lane operation against a fake target and print the result.\n" +
  "     --action <navigate|snapshot|console|network|screenshot>  (default: navigate)\n" +
  "     --url <fakeUrl>    Fake target URL (default: https://fake.target.test).\n" +
  "     --selector <sel>   DOM selector for --action snapshot.\n" +
  "     --redirect <url>   Simulate a redirect (proves redirect denial).\n" +
  "     --fail <timeout|crash|devtools-error>  Inject a categorized diagnostic failure.\n" +
  "     --json             Emit the machine-readable run report.\n";

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

  const report = await runManagedFixtureOperation({
    action: actionArg,
    targetUrl: flagValue(args, "--url") ?? "https://fake.target.test",
    selector: flagValue(args, "--selector"),
    redirectTo: flagValue(args, "--redirect"),
    failure: failArg as ManagedFixtureFailure | undefined,
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

export function browserCommand(args: string[], depsOverride?: Partial<BrowserCommandDeps>): number | Promise<number> {
  const deps = { ...defaultDeps(), ...depsOverride };
  const sub = args[0];
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    deps.stdout(USAGE);
    return 0;
  }
  if (sub === "setup") return setupCommand(args.slice(1), deps);
  if (sub === "doctor") return doctorSubcommand(args.slice(1), deps);
  if (sub === "run") return runSubcommand(args.slice(1), deps);
  process.stderr.write(`roll browser: unknown subcommand '${sub}'\n\n${USAGE}`);
  return 1;
}
