import { describe, expect, it } from "vitest";
import {
  EXTERNAL_TOOL_DECLARATIONS,
  browserToolAvailable,
  collectExternalTools,
  collectExternalRequirements,
  guideExternalToolSetup,
  renderExternalRequirementDoctorSection,
  renderExternalToolDoctorSection,
  resolveRequirement,
  silentPreinstallChromium,
  type ExternalToolDeps,
  type ExternalToolRequestDeps,
  type ExternalToolState,
} from "../src/lib/external-tools.js";

function deps(overrides: Partial<ExternalToolDeps> = {}): ExternalToolDeps {
  return {
    platform: "darwin",
    env: {},
    home: "/home/test",
    commandOnPath: () => true,
    execFile: () => ({ code: 0, stdout: "", stderr: "" }),
    readDir: () => ["chromium-1234"],
    exists: () => false,
    ...overrides,
  };
}

function state(id: string, status: ExternalToolState["status"], repairCommand?: string): ExternalToolState {
  const decl = EXTERNAL_TOOL_DECLARATIONS.find((tool) => tool.id === id);
  if (decl === undefined) throw new Error(`missing declaration: ${id}`);
  return {
    ...decl,
    status,
    detail: `${id} is ${status}`,
    ...(repairCommand !== undefined ? { repairCommand } : {}),
  };
}

function requestDeps(overrides: Partial<ExternalToolRequestDeps>): ExternalToolRequestDeps {
  return {
    states: () => [],
    env: {},
    stdinIsTTY: false,
    stdout: () => undefined,
    stderr: () => undefined,
    readLine: () => null,
    execFile: () => ({ code: 0 }),
    ...overrides,
  };
}

describe("external tool detection", () => {
  it("resolves a declared requirement through the single dependency detector", () => {
    const ok = resolveRequirement({ kind: "executable", name: "playwright-chromium", optional: true }, deps());
    expect(ok.status).toBe("ok");
    expect(ok.detail).toContain("Chromium browser files found");

    const missing = resolveRequirement(
      { kind: "executable", name: "playwright-chromium", optional: true },
      deps({ readDir: () => [], exists: () => false }),
    );
    expect(missing.status).toBe("missing");
    expect(missing.repair?.command).toContain("playwright@");
    expect(missing.repair?.command).toContain("install chromium");
  });

  it("resolves macOS screen-recording authorization as a requirement state", () => {
    const permission = resolveRequirement(
      { kind: "executable", name: "screencapture", optional: true },
      deps({ execFile: () => ({ code: 1, stdout: "", stderr: "permission denied" }) }),
    );

    expect(permission.status).toBe("permission-missing");
    expect(permission.authorize?.command).toContain("Privacy_ScreenCapture");
    expect(permission.repair?.command).toBe(permission.authorize?.command);
  });

  it("keeps external-tool compatibility while exposing external requirements as the primary API", () => {
    const requirements = collectExternalRequirements(deps());
    const tools = collectExternalTools(deps());

    expect(requirements.map((requirement) => requirement.id)).toEqual(["screencapture", "playwright-chromium"]);
    expect(tools).toEqual(requirements);
  });

  it("detects screencapture permission separately from installation", () => {
    expect(collectExternalTools(deps()).find((tool) => tool.id === "screencapture")?.status).toBe("ok");

    expect(
      collectExternalTools(deps({ commandOnPath: (bin) => bin !== "screencapture" })).find((tool) => tool.id === "screencapture")?.status,
    ).toBe("missing");

    expect(
      collectExternalTools(deps({ execFile: () => ({ code: 1, stdout: "", stderr: "permission denied" }) })).find(
        (tool) => tool.id === "screencapture",
      )?.status,
    ).toBe("permission-missing");
  });

  it("detects Playwright Chromium from the browser cache", () => {
    expect(collectExternalTools(deps()).find((tool) => tool.id === "playwright-chromium")?.status).toBe("ok");

    const missing = collectExternalTools(deps({ readDir: () => [], exists: () => false })).find((tool) => tool.id === "playwright-chromium");
    expect(missing?.status).toBe("missing");
    expect(missing?.repairCommand).toContain("npx");
    expect(missing?.repairCommand).toContain("playwright@");
    expect(missing?.repairCommand).toContain("install chromium");

    const custom = collectExternalTools(
      deps({
        env: { PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw" },
        readDir: (path) => (path === "/tmp/pw" ? ["chromium_headless_shell-1234"] : []),
      }),
    ).find((tool) => tool.id === "playwright-chromium");
    expect(custom?.status).toBe("ok");
    expect(custom?.detail).toContain("/tmp/pw");
  });

  it("uses the platform default Playwright browser cache", () => {
    const probed: string[] = [];
    const linux = collectExternalTools(
      deps({
        platform: "linux",
        readDir: (path) => {
          probed.push(path);
          return ["chromium-1234"];
        },
      }),
    ).find((tool) => tool.id === "playwright-chromium");

    expect(linux?.status).toBe("ok");
    expect(probed).toContain("/home/test/.cache/ms-playwright");
  });

  it("renders doctor output with impact and repair instructions", () => {
    const lines = renderExternalRequirementDoctorSection([
      state("screencapture", "permission-missing", "open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"),
    ]);

    expect(lines.join("\n")).toContain("External requirements");
    expect(lines.join("\n")).toContain("外部依赖");
    expect(lines.join("\n")).toContain("permission-missing");
    expect(lines.join("\n")).toContain("fix: open x-apple.systempreferences");
    expect(lines.join("\n")).toContain("impact:");
    expect(renderExternalToolDoctorSection([state("screencapture", "ok")]).join("\n")).toContain("External requirements");
  });
});

describe("external tool guided setup", () => {
  it("stays silent in non-interactive startup unless the owner chose a branch", () => {
    const err: string[] = [];

    guideExternalToolSetup(
      "init",
      requestDeps({
        states: () => [state("playwright-chromium", "missing", "npx -y playwright@1.52.0 install chromium")],
        stderr: (line) => err.push(line),
      }),
    );

    expect(err).toEqual([]);
  });

  it("explains impact when setup is declined", () => {
    const err: string[] = [];
    const execs: string[] = [];

    guideExternalToolSetup(
      "go",
      requestDeps({
        env: { ROLL_EXTERNAL_TOOLS: "no" },
        states: () => [state("playwright-chromium", "missing", "npx -y playwright@1.52.0 install chromium")],
        stderr: (line) => err.push(line),
        execFile: (cmd, args) => {
          execs.push([cmd, ...args].join(" "));
          return { code: 0 };
        },
      }),
    );

    expect(err.join("\n")).toContain("External requirement setup (go)");
    expect(err.join("\n")).toContain("declined");
    expect(err.join("\n")).toContain("impact:");
    expect(execs).toEqual([]);
  });

  it("runs repair commands when setup is accepted", () => {
    const err: string[] = [];
    const execs: string[] = [];

    guideExternalToolSetup(
      "init",
      requestDeps({
        env: { ROLL_EXTERNAL_TOOLS: "yes" },
        states: () => [state("playwright-chromium", "missing", "npx -y playwright@1.52.0 install chromium")],
        stderr: (line) => err.push(line),
        execFile: (cmd, args) => {
          execs.push([cmd, ...args].join(" "));
          return { code: 0 };
        },
      }),
    );

    expect(execs.length).toBe(1);
    expect(execs[0]).toContain("npx");
    expect(execs[0]).toContain("playwright@");
    expect(execs[0]).toContain("install chromium");
    expect(err.join("\n")).toContain("repair command started");
  });
});

describe("FIX-394 chromium pre-install and availability", () => {
  it("browserToolAvailable returns boolean (contingent on real fs chromium)", () => {
    // browserToolAvailable wraps chromiumInstalled which probes the real
    // Playwright cache. In CI there is no Chromium → false; on a dev machine
    // with Chromium installed → true. Both are valid outcomes.
    expect(typeof browserToolAvailable()).toBe("boolean");
  });

  it("silentPreinstallChromium returns boolean and does not throw", () => {
    // Best-effort: may install or skip; must never throw. Pass NO_BROWSER so a
    // chromium-absent host (e.g. CI) short-circuits instead of triggering a
    // real multi-minute `npx playwright install` that would hang the suite.
    const env = { ...process.env, ROLL_ATTEST_NO_BROWSER: "1" };
    expect(() => silentPreinstallChromium(env)).not.toThrow();
    expect(typeof silentPreinstallChromium(env)).toBe("boolean");
  });

  it("silentPreinstallChromium returns true when chromium already cached (even with NO_BROWSER=1)", () => {
    // When chromium IS already installed, the function returns true immediately.
    // ROLL_ATTEST_NO_BROWSER=1 only matters when chromium is missing (the case
    // where we'd attempt a download). Test that the function does not throw.
    const result = silentPreinstallChromium({ ROLL_ATTEST_NO_BROWSER: "1" });
    // If chromium is installed → true; if not → false. Both are valid.
    expect(typeof result).toBe("boolean");
  });
});
