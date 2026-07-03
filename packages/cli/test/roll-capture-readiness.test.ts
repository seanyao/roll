import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    expect(readiness.hostPermission).toMatchObject({ status: "granted" });
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
    expect(readiness.hostPermission.status).toBe("denied");
    expect(readiness.detailLines.join("\n")).toContain("installed=missing");
    expect(readiness.detailLines.join("\n")).toContain("hostPermission=denied");
  });

  it("documents that the swift permission probe is only a current-host proxy", () => {
    const readiness = collectRollCaptureReadiness(deps());
    const detail = readiness.detailLines.join("\n");

    expect(detail).toContain("hostPermission=granted");
    expect(detail).toContain("current host process");
    expect(detail).toContain("Roll Capture.app manages its own Screen Recording permission on first capture");
    expect(detail).toContain("宿主权限代理");
  });

  it("does not trust stale Spotlight app paths unless the path still exists as a directory", () => {
    const readiness = collectRollCaptureReadiness(
      deps({
        exists: () => false,
        execFile: (cmd) => {
          if (cmd === "mdfind") return { code: 0, stdout: "/Applications/Deleted Roll Capture.app\n", stderr: "" };
          return { code: 0, stdout: "true\n", stderr: "" };
        },
      }),
    );

    expect(readiness.installed.status).toBe("missing");
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
    expect(collectRollCaptureReadiness(deps({ env: { GITHUB_ACTIONS: "true" } })).status).toBe("skip");
    expect(collectRollCaptureReadiness(deps({ env: { GITLAB_CI: "true" } })).status).toBe("skip");
    expect(collectRollCaptureReadiness(deps({ env: { JENKINS_HOME: "/var/jenkins" } })).status).toBe("skip");
  });

  it("caches Roll Capture probes within the TTL and refreshes after expiry", () => {
    const home = tmp("cache-home");
    const rollHome = join(home, ".roll");
    const appPath = join(home, "Applications", "Roll Capture.app");
    mkdirSync(appPath, { recursive: true });
    let now = 1_000;
    let execCalls = 0;
    const cachedDeps = deps({
      home,
      env: { ROLL_HOME: rollHome },
      cacheReadiness: true,
      nowMs: () => now,
      exists: (path) => path === appPath,
      execFile: (cmd) => {
        execCalls += 1;
        if (cmd === "mdfind") return { code: 0, stdout: `${appPath}\n`, stderr: "" };
        return { code: 0, stdout: "true\n", stderr: "" };
      },
    });

    expect(collectRollCaptureReadiness(cachedDeps).status).toBe("available");
    expect(collectRollCaptureReadiness(cachedDeps).status).toBe("available");
    expect(execCalls).toBe(1);

    now += 31 * 60 * 1000;
    expect(collectRollCaptureReadiness(cachedDeps).status).toBe("available");
    expect(execCalls).toBe(2);
  });

  it("bypasses the Roll Capture readiness cache when refresh is requested", () => {
    const home = tmp("refresh-home");
    const appPath = join(home, "Applications", "Roll Capture.app");
    mkdirSync(appPath, { recursive: true });
    let execCalls = 0;
    const cachedDeps = deps({
      home,
      env: { ROLL_HOME: join(home, ".roll") },
      cacheReadiness: true,
      exists: (path) => path === appPath,
      execFile: () => {
        execCalls += 1;
        return { code: 0, stdout: "true\n", stderr: "" };
      },
    });

    expect(collectRollCaptureReadiness(cachedDeps).status).toBe("available");
    expect(collectRollCaptureReadiness({ ...cachedDeps, refreshCache: true }).status).toBe("available");
    expect(execCalls).toBe(2);
  });

  it("renders setup guidance only when owner action is useful", () => {
    const missing = collectRollCaptureReadiness(deps({ exists: () => false }));
    expect(renderRollCaptureSetupGuidance(missing, "en")).toContain("Install Roll Capture.app");
    expect(renderRollCaptureSetupGuidance(missing, "zh")).toContain("安装 Roll Capture.app");

    const skipped = collectRollCaptureReadiness(deps({ interactive: false }));
    expect(renderRollCaptureSetupGuidance(skipped, "en")).toBeNull();
  });
});
