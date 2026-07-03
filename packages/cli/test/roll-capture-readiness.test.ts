import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  collectRollCaptureReadiness,
  renderRollCaptureSetupGuidance,
  type RollCaptureReadinessDeps,
} from "../src/lib/roll-capture-readiness.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tmp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `roll-capture-readiness-${tag}-`));
  dirs.push(dir);
  return dir;
}

function deps(overrides: Partial<RollCaptureReadinessDeps> = {}): RollCaptureReadinessDeps {
  const home = tmp("home");
  return {
    platform: "darwin",
    env: {},
    home,
    interactive: true,
    hasAquaGUI: true,
    exists: () => true,
    execFile: () => ({ code: 0, stdout: "true\n", stderr: "" }),
    ...overrides,
  };
}

describe("US-PHYSICAL-003 Roll Capture readiness", () => {
  it("reports installed, permission granted, and writable inbox", () => {
    const readiness = collectRollCaptureReadiness(deps());

    expect(readiness.status).toBe("available");
    expect(readiness.installed).toMatchObject({ status: "installed" });
    expect(readiness.permission).toMatchObject({ status: "granted" });
    expect(readiness.inbox).toMatchObject({ status: "writable" });
    expect(statSync(readiness.inbox.path).isDirectory()).toBe(true);
  });

  it("reports missing install and denied permission as non-blocking warnings", () => {
    const readiness = collectRollCaptureReadiness(
      deps({
        exists: () => false,
        execFile: () => ({ code: 0, stdout: "false\n", stderr: "" }),
      }),
    );

    expect(readiness.status).toBe("degraded");
    expect(readiness.installed.status).toBe("missing");
    expect(readiness.permission.status).toBe("denied");
    expect(readiness.detailLines.join("\n")).toContain("installed=missing");
    expect(readiness.detailLines.join("\n")).toContain("permission=denied");
  });

  it("verifies inbox writability via a sibling temp file and atomic rename", () => {
    const home = tmp("readonly-home");
    const calls: string[][] = [];
    const readiness = collectRollCaptureReadiness(
      deps({
        home,
        execFile: (cmd, args) => {
          calls.push([cmd, ...args]);
          return { code: 0, stdout: "true\n", stderr: "" };
        },
      }),
    );

    expect(readiness.inbox.status).toBe("writable");
    expect(calls[0]?.join(" ")).toContain("CGPreflightScreenCaptureAccess");
  });

  it("reports a blocked inbox without throwing", () => {
    const home = tmp("blocked-home");
    const blockedRoot = join(home, "blocked-root");
    writeFileSync(blockedRoot, "not a directory");
    const readiness = collectRollCaptureReadiness(deps({ home, env: { ROLL_CAPTURE_HOME: blockedRoot } }));

    expect(readiness.status).toBe("degraded");
    expect(readiness.inbox.status).toBe("blocked");
    expect(readiness.detailLines.join("\n")).toContain("inbox=blocked");
  });

  it("skips cleanly in headless or non-macOS environments", () => {
    expect(collectRollCaptureReadiness(deps({ platform: "linux" })).status).toBe("skip");
    expect(collectRollCaptureReadiness(deps({ interactive: false })).status).toBe("skip");
    expect(collectRollCaptureReadiness(deps({ env: { CI: "1" } })).status).toBe("skip");
  });

  it("renders setup guidance only when owner action is useful", () => {
    const missing = collectRollCaptureReadiness(deps({ exists: () => false }));
    expect(renderRollCaptureSetupGuidance(missing, "en")).toContain("Install Roll Capture.app");
    expect(renderRollCaptureSetupGuidance(missing, "zh")).toContain("安装 Roll Capture.app");

    const skipped = collectRollCaptureReadiness(deps({ interactive: false }));
    expect(renderRollCaptureSetupGuidance(skipped, "en")).toBeNull();
  });
});
