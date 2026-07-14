import { describe, expect, it, vi } from "vitest";
import type { BrowserEnvironmentReadiness } from "@roll/spec";
import { browserCommand } from "../src/commands/browser.js";
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
  it("setup --dry-run prints proposed config + preflight and writes nothing", () => {
    const c = capture();
    const write = vi.fn();
    const code = browserCommand(["setup", "--dry-run"], {
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

  it("setup without --confirm refuses and writes nothing (explicit owner confirmation required)", () => {
    const c = capture();
    const write = vi.fn();
    const code = browserCommand(["setup"], {
      ...noWriteDeps(),
      writeFile: write,
      readiness: () => fixtureReadiness({}),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(c.read()).toMatch(/requires explicit owner confirmation/i);
  });

  it("setup --confirm writes the machine config exactly once", () => {
    const c = capture();
    const write = vi.fn();
    const code = browserCommand(["setup", "--confirm"], {
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

  it("doctor --json reports each lane's verdict machine-readably", () => {
    const c = capture();
    const code = browserCommand(["doctor", "--json"], {
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

  it("a missing-dependency doctor never reports a lane as ready (no false pass)", () => {
    const c = capture();
    browserCommand(["doctor"], {
      ...noWriteDeps(),
      readiness: () => fixtureReadiness({ _ROLL_BROWSER_CHROME: "missing", _ROLL_BROWSER_MCP: "missing", _ROLL_BROWSER_REMOTE_DEBUG: "off" }),
      stdout: c.stdout,
    });
    expect(c.read()).not.toMatch(/managed: *ready/);
    expect(c.read()).toMatch(/managed:\s+degraded/);
  });

  it("unknown subcommand fails loud", () => {
    const c = capture();
    const code = browserCommand(["frobnicate"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(1);
  });
});
