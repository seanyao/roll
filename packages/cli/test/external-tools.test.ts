import { describe, expect, it } from "vitest";
import {
  EXTERNAL_TOOL_DECLARATIONS,
  collectExternalTools,
  guideExternalToolSetup,
  renderExternalToolDoctorSection,
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
    expect(missing?.repairCommand).toBe("npx playwright install chromium");

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
    const lines = renderExternalToolDoctorSection([
      state("screencapture", "permission-missing", "open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"),
    ]);

    expect(lines.join("\n")).toContain("External tools");
    expect(lines.join("\n")).toContain("外部工具");
    expect(lines.join("\n")).toContain("permission-missing");
    expect(lines.join("\n")).toContain("fix: open x-apple.systempreferences");
    expect(lines.join("\n")).toContain("impact:");
  });
});

describe("external tool guided setup", () => {
  it("stays silent in non-interactive startup unless the owner chose a branch", () => {
    const err: string[] = [];

    guideExternalToolSetup(
      "init",
      requestDeps({
        states: () => [state("playwright-chromium", "missing", "npx playwright install chromium")],
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
        states: () => [state("playwright-chromium", "missing", "npx playwright install chromium")],
        stderr: (line) => err.push(line),
        execFile: (cmd, args) => {
          execs.push([cmd, ...args].join(" "));
          return { code: 0 };
        },
      }),
    );

    expect(err.join("\n")).toContain("External tool setup (go)");
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
        states: () => [state("playwright-chromium", "missing", "npx playwright install chromium")],
        stderr: (line) => err.push(line),
        execFile: (cmd, args) => {
          execs.push([cmd, ...args].join(" "));
          return { code: 0 };
        },
      }),
    );

    expect(execs).toEqual(["npx playwright install chromium"]);
    expect(err.join("\n")).toContain("repair command started");
  });
});
