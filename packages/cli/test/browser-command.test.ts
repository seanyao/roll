import { describe, expect, it, vi } from "vitest";
import type { BrowserEnvironmentReadiness } from "@roll/spec";
import {
  NO_UPDATE_AVAILABLE,
  type VersionSource,
} from "@roll/core";
import { browserCommand } from "../src/commands/browser.js";
import type { InteractiveOperationResult } from "@roll/infra";
import { collectBrowserEnvironmentReadiness } from "../src/lib/browser-readiness-doctor.js";
import { defaultBrowserEnvironmentProbeDeps } from "@roll/infra";

function fixtureReadiness(overrides: NodeJS.ProcessEnv): BrowserEnvironmentReadiness {
  const base = defaultBrowserEnvironmentProbeDeps();
  return collectBrowserEnvironmentReadiness(
    {
      status: "skip",
      installed: { status: "missing" },
      hostPermission: { status: "skipped", detail: "headless" },
      inbox: { status: "skipped", path: "/tmp/inbox", detail: "headless" },
      detailLines: ["skipped — headless / CI"],
      repairCommands: [],
    },
    { ...base, env: { ...overrides }, tcpReachable: () => false },
  );
}

function capture() {
  let text = "";
  return { stdout: (s: string) => (text += s), read: () => text };
}

const noWriteDeps = () => ({
  configPath: () => "/tmp/should-not-write/browser-operations.yaml",
  writeFile: vi.fn(),
  fileExists: () => false,
});

describe("US-BROW-003 roll browser", () => {
  it("setup --dry-run prints proposed config + preflight and writes nothing", async () => {
    const c = capture();
    const write = vi.fn();
    const code = await browserCommand(["setup", "--dry-run"], {
      ...noWriteDeps(),
      writeFile: write,
      readiness: () => fixtureReadiness({ _ROLL_BROWSER_CHROME: "missing", _ROLL_BROWSER_MCP: "missing" }),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(c.read()).toContain("chrome-devtools-mcp@1.5.0");
    expect(c.read()).toContain("dry-run: no configuration was written");
    expect(c.read()).toMatch(/never enables owner Chrome remote debugging/i);
  });

  it("setup without --confirm refuses and writes nothing (explicit owner confirmation required)", async () => {
    const c = capture();
    const write = vi.fn();
    const code = await browserCommand(["setup"], {
      ...noWriteDeps(),
      writeFile: write,
      readiness: () => fixtureReadiness({}),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(c.read()).toMatch(/requires explicit owner confirmation/i);
  });

  it("setup --confirm writes the machine config exactly once", async () => {
    const c = capture();
    const write = vi.fn();
    const code = await browserCommand(["setup", "--confirm"], {
      configPath: () => "/tmp/roll-test/browser-operations.yaml",
      writeFile: write,
      fileExists: () => false,
      readiness: () => fixtureReadiness({}),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[1]).toContain("chrome-devtools-mcp@1.5.0");
    expect(c.read()).toContain("wrote /tmp/roll-test/browser-operations.yaml");
  });

  it("doctor --json reports each lane's verdict machine-readably", async () => {
    const c = capture();
    const code = await browserCommand(["doctor", "--json"], {
      ...noWriteDeps(),
      readiness: () =>
        // chrome present + mcp missing → managed degraded; remote debug off with
        // chrome present → interactive blocked; capture skip → degraded.
        fixtureReadiness({ _ROLL_BROWSER_NODE: "present", _ROLL_BROWSER_NPX: "present", _ROLL_BROWSER_CHROME: "present", _ROLL_BROWSER_MCP: "missing", _ROLL_BROWSER_REMOTE_DEBUG: "off" }),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(c.read()) as BrowserEnvironmentReadiness;
    expect(["ready", "degraded", "blocked"]).toContain(parsed.managed.verdict);
    expect(parsed.managed.verdict).toBe("degraded");
    expect(parsed.interactive.verdict).toBe("blocked");
    expect(parsed.capture.verdict).toBe("degraded");
  });

  it("a missing-dependency doctor never reports a lane as ready (no false pass)", async () => {
    const c = capture();
    await browserCommand(["doctor"], {
      ...noWriteDeps(),
      readiness: () => fixtureReadiness({ _ROLL_BROWSER_CHROME: "missing", _ROLL_BROWSER_MCP: "missing", _ROLL_BROWSER_REMOTE_DEBUG: "off" }),
      stdout: c.stdout,
    });
    expect(c.read()).not.toMatch(/managed: *ready/);
    expect(c.read()).toMatch(/managed:\s+degraded/);
  });

  it("unknown subcommand fails loud", async () => {
    const c = capture();
    const code = await browserCommand(["frobnicate"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(1);
  });
});

describe("US-BROW-010 roll browser update", () => {
  const pinnedCfg = "devtools:\n  package_version: 1.5.0\n";

  it("update --check reports pinned version and available candidate without side effects", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();

    const code = await browserCommand(["update", "--check"], {
      ...noWriteDeps(),
      readFile,
      writeFile,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    const out = c.read();
    expect(out).toContain("1.5.0");
    expect(out).toContain("1.6.0");
    expect(out).toContain("update");
  });

  it("update --check reports no update when version source returns NO_UPDATE_AVAILABLE", async () => {
    const c = capture();
    const versionSource: VersionSource = () => NO_UPDATE_AVAILABLE;
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();

    const code = await browserCommand(["update", "--check"], {
      ...noWriteDeps(),
      readFile,
      writeFile,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    const out = c.read();
    expect(out).toContain("1.5.0");
    expect(out).toContain("up to date");
  });

  it("update --apply without --confirm refuses and writes nothing", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();

    const code = await browserCommand(["update", "--apply"], {
      ...noWriteDeps(),
      readFile,
      writeFile,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(c.read()).toMatch(/explicit owner confirmation/i);
  });

  it("update --apply --confirm runs smoke check + doctor, applies on success", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();
    let smokeRan = false;

    const code = await browserCommand(["update", "--apply", "--confirm"], {
      configPath: () => "/tmp/roll-test/browser-operations.yaml",
      readFile,
      writeFile,
      fileExists: () => true,
      versionSource,
      smokeCheck: async () => { smokeRan = true; return true; },
      readiness: () => fixtureReadiness({}),
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(smokeRan).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0]?.[1]).toContain("1.6.0");
    const out = c.read();
    expect(out).toContain("applied");
    expect(out).toContain("1.6.0");
    expect(out).toContain("/tmp/roll-test/browser-operations.yaml");
    // AC3: smoke + contract checks plus browser doctor
    expect(out).toContain("smoke check: passed");
    expect(out).toContain("browser doctor");
  });

  it("update --apply --confirm keeps prior version when smoke check fails", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();
    let smokeRan = false;

    const code = await browserCommand(["update", "--apply", "--confirm"], {
      configPath: () => "/tmp/roll-test/browser-operations.yaml",
      readFile,
      writeFile,
      fileExists: () => true,
      versionSource,
      smokeCheck: async () => { smokeRan = true; return false; },
      readiness: () => fixtureReadiness({}),
      stdout: c.stdout,
    });

    expect(code).toBe(1);
    expect(smokeRan).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
    const out = c.read();
    expect(out).toContain("verification failed");
    expect(out).toContain("smoke check failed");
    // AC3: doctor is still shown on verification failure for diagnostics
    expect(out).toContain("browser doctor");
  });

  it("update --check --json reports machine-readable result", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);

    const code = await browserCommand(["update", "--check", "--json"], {
      ...noWriteDeps(),
      readFile,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(c.read());
    expect(parsed.pinned).toBe("1.5.0");
    expect(parsed.candidate).toBe("1.6.0");
    expect(parsed.updateAvailable).toBe(true);
  });

  it("update --apply --confirm with no update available reports no-op", async () => {
    const c = capture();
    const versionSource: VersionSource = () => NO_UPDATE_AVAILABLE;
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();

    const code = await browserCommand(["update", "--apply", "--confirm"], {
      configPath: () => "/tmp/roll-test/browser-operations.yaml",
      readFile,
      writeFile,
      fileExists: () => true,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(c.read()).toContain("up to date");
  });

  it("update with no flags defaults to --check", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();

    const code = await browserCommand(["update"], {
      ...noWriteDeps(),
      readFile,
      writeFile,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    const out = c.read();
    expect(out).toContain("1.5.0");
    expect(out).toContain("1.6.0");
  });

  it("E2E golden path: update --check produces the full user-facing output", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);

    const code = await browserCommand(["update", "--check"], {
      ...noWriteDeps(),
      readFile,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    const out = c.read();
    // Verify the full user-facing output structure
    expect(out).toMatch(/DevTools transport update check/);
    expect(out).toMatch(/DevTools 传输更新检查/);
    expect(out).toContain("pinned:    1.5.0");
    expect(out).toContain("candidate: 1.6.0");
    expect(out).toMatch(/Update available.*1\.5\.0.*1\.6\.0/);
    expect(out).toMatch(/有可用更新.*1\.5\.0.*1\.6\.0/);
    expect(out).toContain("roll browser update --apply --confirm");
    // Must NOT contain "installing", "downloading", "wrote", or "package.json"
    expect(out).not.toMatch(/installing|downloading/i);
    expect(out).not.toContain("wrote");
    expect(out).not.toContain("package.json");
  });

  it("E2E golden path: update --check with no update shows up-to-date message", async () => {
    const c = capture();
    const versionSource: VersionSource = () => NO_UPDATE_AVAILABLE;
    const readFile = vi.fn(() => pinnedCfg);

    const code = await browserCommand(["update", "--check"], {
      ...noWriteDeps(),
      readFile,
      versionSource,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    const out = c.read();
    expect(out).toContain("pinned:    1.5.0");
    expect(out).toContain("candidate: (none)");
    expect(out).toContain("Already up to date");
    expect(out).toContain("已是最新版本");
  });

  it("update --apply --confirm succeeds without injected smokeCheck (default smokeCheck works)", async () => {
    const c = capture();
    const versionSource: VersionSource = () => "1.6.0";
    const readFile = vi.fn(() => pinnedCfg);
    const writeFile = vi.fn();

    // No smokeCheck injected — relies on defaultDeps() default
    const code = await browserCommand(["update", "--apply", "--confirm"], {
      configPath: () => "/tmp/roll-test/browser-operations.yaml",
      readFile,
      writeFile,
      fileExists: () => true,
      versionSource,
      readiness: () => fixtureReadiness({}),
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const out = c.read();
    expect(out).toContain("applied");
    expect(out).toContain("smoke check: passed");
    expect(out).toContain("browser doctor");
  });
});

describe("US-BROW-008b roll browser interactive", () => {
  const interactiveArgs = [
    "interactive",
    "--story", "US-BROW-008b",
    "--origin", "https://app.example.test",
    "--action", "navigate",
    "--url", "https://app.example.test/account",
  ];

  it("rejects non-TTY callers before requesting owner approval", async () => {
    const c = capture();
    const approve = vi.fn();
    const run = vi.fn();

    const code = await browserCommand(interactiveArgs, {
      ...noWriteDeps(),
      isTTY: () => false,
      readApproval: approve,
      interactiveRun: run,
      stdout: c.stdout,
    });

    expect(code).toBe(1);
    expect(approve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(c.read()).toMatch(/requires an attached TTY/i);
  });

  it("shows the full owner approval payload, then runs exactly one approved action without claiming CI passed", async () => {
    const c = capture();
    const approve = vi.fn(async () => true);
    const result: InteractiveOperationResult = {
      kind: "completed",
      tabId: "owner-tab",
      ciPassed: false,
      result: { runId: "run", actionId: "action", status: "ok", diagnosticRefs: [], redactedSummary: "navigated to approved origin" },
    };
    const run = vi.fn(async () => result);

    const code = await browserCommand(interactiveArgs, {
      ...noWriteDeps(),
      isTTY: () => true,
      readApproval: approve,
      interactiveRun: run,
      stdout: c.stdout,
    });

    expect(code).toBe(0);
    expect(approve).toHaveBeenCalledOnce();
    expect(approve.mock.calls[0]?.[0]).toContain("story: US-BROW-008b");
    expect(approve.mock.calls[0]?.[0]).toContain("origin: https://app.example.test");
    expect(approve.mock.calls[0]?.[0]).toContain("credential export: denied");
    expect(approve.mock.calls[0]?.[0]).toContain("expiry:");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ storyId: "US-BROW-008b", origin: "https://app.example.test" }));
    expect(c.read()).toContain("manual owner-run result: ok");
    expect(c.read()).toContain("does not make CI pass");
  });

  it("stops on owner denial without connecting to Chrome", async () => {
    const c = capture();
    const run = vi.fn();

    const code = await browserCommand(interactiveArgs, {
      ...noWriteDeps(),
      isTTY: () => true,
      readApproval: async () => false,
      interactiveRun: run,
      stdout: c.stdout,
    });

    expect(code).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(c.read()).toMatch(/owner declined/i);

describe("US-BROW-014 roll browser run --profile", () => {
  it("accepts a valid device profile name and includes it in the output", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--profile", "Pixel 7", "--action", "navigate"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const out = c.read();
    expect(out).toContain("device profile / 设备仿真: Pixel 7");
  });

  it("rejects an unknown device profile at the CLI level with non-zero exit", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--profile", "UnknownPhone"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(1);
  });

  it("resolves profile case-insensitively", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--profile", "iphone 14", "--action", "screenshot"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const out = c.read();
    expect(out).toContain("device profile / 设备仿真: iphone 14");
  });

  it("baseline unchanged: run without --profile still works (no device profile section)", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--action", "snapshot"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const out = c.read();
    expect(out).not.toContain("device profile");
  });

  it("--json output includes deviceProfile field when set", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--profile", "iPad Pro", "--json"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(c.read());
    expect(parsed.deviceProfile).toBe("iPad Pro");
  });

  it("--json output excludes deviceProfile field when not set", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--json"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(c.read());
    expect(parsed.deviceProfile).toBeUndefined();
  });
});
