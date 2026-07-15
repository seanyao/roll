/**
 * US-BROW-007 — released `roll browser` help + semantics, locked as the
 * source of truth the documentation projects.
 *
 * The guides (guide/en/browser-operations.md, guide/zh/browser-operations.md)
 * describe exactly this surface. These assertions fail loudly if the help ever
 * starts implying automatic installation, owner-Chrome access, or
 * DevTools-diagnostics-as-visual-acceptance — the three claims the docs must
 * never make.
 */
import { describe, expect, it, vi } from "vitest";
import type { BrowserEnvironmentReadiness } from "@roll/spec";
import { browserCommand } from "../src/commands/browser.js";
import { collectBrowserEnvironmentReadiness } from "../src/lib/browser-readiness-doctor.js";
import { defaultBrowserEnvironmentProbeDeps } from "@roll/infra";

function capture() {
  let text = "";
  return { stdout: (s: string) => (text += s), read: () => text };
}

/** Deterministic readiness so the doctor render is snapshot-stable. */
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

const noWriteDeps = () => ({
  configPath: () => "/tmp/should-not-write/browser-operations.yaml",
  writeFile: vi.fn(),
  fileExists: () => false,
});

describe("US-BROW-007 — documented `roll browser` surface", () => {
  it("AC2: help lists the released subcommands (setup / doctor / run / update)", async () => {
    const c = capture();
    const code = await browserCommand(["--help"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(0);
    const out = c.read();
    for (const sub of ["setup", "doctor", "run", "update"]) {
      expect(out, `help must list "${sub}"`).toContain(sub);
    }
    expect(out).toMatchSnapshot();
  });

  it("AC2: help never implies automatic installation or owner-Chrome remote debugging", async () => {
    const c = capture();
    await browserCommand(["--help"], { ...noWriteDeps(), stdout: c.stdout });
    const out = c.read().toLowerCase();
    // no auto-install promise
    expect(out).not.toMatch(/automatically install|auto-install|installs? .*dependenc/);
    // setup writes config, never a product package.json, only with --confirm
    expect(out).toMatch(/setup --confirm/);
  });

  it("AC2: help states interactive lane does not support background scheduler, remote endpoint, cookie export, or automatic Chrome startup", async () => {
    const c = capture();
    await browserCommand(["--help"], { ...noWriteDeps(), stdout: c.stdout });
    const out = c.read();
    expect(out).toMatch(/No background scheduler/);
    expect(out).toMatch(/remote endpoint/);
    expect(out).toMatch(/cookie export/);
    expect(out).toMatch(/automatic Chrome startup/);
  });

  it("AC1: setup --dry-run previews machine config + preflight and writes nothing", async () => {
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
    const out = c.read();
    expect(out).toContain("dry-run: no configuration was written");
    expect(out).toMatch(/never installs into a product package\.json/i);
    expect(out).toMatch(/never enables owner Chrome remote debugging/i);
  });

  it("AC1: doctor reports the three lanes as ready|degraded|blocked", async () => {
    const c = capture();
    const code = await browserCommand(["doctor"], {
      ...noWriteDeps(),
      readiness: () => fixtureReadiness({ _ROLL_BROWSER_CHROME: "missing", _ROLL_BROWSER_MCP: "missing" }),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const out = c.read();
    expect(out).toContain("managed:");
    expect(out).toContain("interactive:");
    expect(out).toContain("capture:");
  });

  it("AC2: managed `run` states plainly that diagnostics are NOT visual acceptance evidence", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--action", "screenshot"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(0);
    const out = c.read();
    expect(out).toMatch(/Diagnostic success is not visual acceptance evidence/i);
    expect(out).toMatch(/诊断通过不等于视觉验收证据/);
    // temp profile only — owner state is never entered
    expect(out).toMatch(/owner state never entered/i);
  });

  it("US-BROW-015: help keeps optional diagnostic profiles outside visual acceptance and multi-browser claims", async () => {
    const c = capture();
    await browserCommand(["--help"], { ...noWriteDeps(), stdout: c.stdout });
    const out = c.read();
    expect(out).toMatch(/not visual acceptance evidence or a multi-browser matrix/i);
    expect(out).toMatchSnapshot();
  });

  it("AC2: managed `run` denies an out-of-allowlist redirect (no owner navigation)", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--redirect", "https://evil.test"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(0);
    expect(c.read()).toMatch(/denied/i);
  });
});
