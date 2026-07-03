import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  installRollCapture,
  renderRollCaptureInstallResult,
  runRollCapturePostinstall,
  type RollCaptureInstallDeps,
} from "../src/lib/roll-capture-install.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tmp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `roll-capture-install-${tag}-`));
  dirs.push(dir);
  return dir;
}

function deps(overrides: Partial<RollCaptureInstallDeps> = {}): RollCaptureInstallDeps {
  const home = tmp("home");
  return {
    platform: "darwin",
    env: {},
    home,
    hasAquaGUI: true,
    exists: existsSync,
    execFile: () => ({ code: 0, stdout: "", stderr: "" }),
    fetchLatestRelease: async () => ({
      tagName: "v0.2.0",
      assets: [{ name: "Roll-Capture.app.zip", size: 4, browserDownloadUrl: "https://example.test/Roll-Capture.app.zip" }],
    }),
    downloadAsset: async () => Buffer.from("ZIP!"),
    extractZip: async (_zipPath, destination) => {
      const app = join(destination, "Roll Capture.app");
      const macos = join(app, "Contents", "MacOS");
      mkdirSync(macos, { recursive: true });
      writeFileSync(join(macos, "Roll Capture"), "#!/bin/sh\n", { mode: 0o755 });
      writeFileSync(join(app, "Contents", "Info.plist"), plist("0.2.0"));
      return { ok: true };
    },
    ...overrides,
  };
}

function plist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`;
}

describe("US-PHYSICAL-005 Roll Capture installer", () => {
  it("downloads the latest release asset and installs Roll Capture.app into ~/Applications", async () => {
    const calls: string[] = [];
    const home = tmp("success-home");
    const result = await installRollCapture(
      deps({
        home,
        downloadAsset: async (url) => {
          calls.push(url);
          return Buffer.from("ZIP!");
        },
      }),
    );

    const appPath = join(home, "Applications", "Roll Capture.app");
    expect(result.status).toBe("installed");
    expect(result.appPath).toBe(appPath);
    expect(calls).toEqual(["https://example.test/Roll-Capture.app.zip"]);
    expect(statSync(join(appPath, "Contents", "MacOS", "Roll Capture")).mode & 0o111).not.toBe(0);
    expect(renderRollCaptureInstallResult(result, "en")).toContain("open it once and grant Screen Recording permission");
  });

  it("invalidates stale Roll Capture readiness cache after a successful install", async () => {
    const home = tmp("cache-home");
    const cachePath = join(home, ".roll", "cache", "roll-capture-readiness.json");
    mkdirSync(join(home, ".roll", "cache"), { recursive: true });
    writeFileSync(cachePath, '{"readiness":{"status":"degraded"}}\n');

    const result = await installRollCapture(deps({ home }));

    expect(result.status).toBe("installed");
    expect(existsSync(cachePath)).toBe(false);
  });

  it("skips an existing app without downloading and reports an optional update hint", async () => {
    const home = tmp("existing-home");
    const appPath = join(home, "Applications", "Roll Capture.app");
    mkdirSync(join(appPath, "Contents"), { recursive: true });
    writeFileSync(join(appPath, "Contents", "Info.plist"), plist("0.1.0"));
    let downloads = 0;

    const result = await installRollCapture(
      deps({
        home,
        downloadAsset: async () => {
          downloads += 1;
          return Buffer.from("ZIP!");
        },
      }),
    );

    expect(result.status).toBe("already-installed");
    expect(downloads).toBe(0);
    expect(renderRollCaptureInstallResult(result, "en")).toContain("newer release v0.2.0 is available");
  });

  it("falls back to manual guidance when the latest release has no app zip asset", async () => {
    const result = await installRollCapture(
      deps({
        fetchLatestRelease: async () => ({ tagName: "v0.2.0", assets: [] }),
      }),
    );

    expect(result.status).toBe("manual");
    expect(result.reason).toContain("Roll-Capture.app.zip");
    expect(renderRollCaptureInstallResult(result, "zh")).toContain("请手动安装");
  });

  it("falls back to manual guidance when download fails or the zip validation fails", async () => {
    const failedDownload = await installRollCapture(
      deps({
        downloadAsset: async () => {
          throw new Error("404");
        },
      }),
    );
    const badZip = await installRollCapture(deps({ extractZip: async () => ({ ok: false, detail: "bad zip" }) }));

    expect(failedDownload.status).toBe("manual");
    expect(failedDownload.reason).toContain("404");
    expect(badZip.status).toBe("manual");
    expect(badZip.reason).toContain("bad zip");
  });

  it("skips non-macOS, CI, headless, and explicit policy-off environments", async () => {
    await expect(installRollCapture(deps({ platform: "linux" }))).resolves.toMatchObject({ status: "skipped", reason: "non-darwin" });
    await expect(installRollCapture(deps({ env: { GITHUB_ACTIONS: "true" } }))).resolves.toMatchObject({ status: "skipped", reason: "ci" });
    await expect(installRollCapture(deps({ hasAquaGUI: false }))).resolves.toMatchObject({ status: "skipped", reason: "headless" });
    await expect(installRollCapture(deps({ env: { ROLL_SKIP_CAPTURE_INSTALL: "1" } }))).resolves.toMatchObject({ status: "skipped", reason: "disabled" });
  });

  it("postinstall never throws and returns a rendered one-line outcome", async () => {
    const lines: string[] = [];
    const status = await runRollCapturePostinstall({
      deps: deps({ env: { CI: "1" } }),
      writeLine: (line) => lines.push(line),
      lang: "en",
    });

    expect(status).toBe(0);
    expect(lines.join("\n")).toContain("skipped");
  });

  it.each([
    ["non-macOS", deps({ platform: "linux" }), "non-darwin"],
    ["CI", deps({ env: { GITHUB_ACTIONS: "true" } }), "ci"],
    ["headless", deps({ hasAquaGUI: false }), "headless"],
    ["policy-off", deps({ env: { ROLL_SKIP_CAPTURE_INSTALL: "1" } }), "disabled"],
  ])("postinstall exits 0 and prints one skipped line for %s", async (_name, installDeps, reason) => {
    const lines: string[] = [];
    const status = await runRollCapturePostinstall({
      deps: installDeps,
      writeLine: (line) => lines.push(line),
      lang: "en",
    });

    expect(status).toBe(0);
    expect(lines).toEqual([`Roll Capture.app install skipped (${reason}).`]);
  });

  it("postinstall exits 0 and renders manual guidance when download lookup fails", async () => {
    const lines: string[] = [];
    const status = await runRollCapturePostinstall({
      deps: deps({
        fetchLatestRelease: async () => {
          throw new Error("offline");
        },
      }),
      writeLine: (line) => lines.push(line),
      lang: "en",
    });

    expect(status).toBe(0);
    expect(lines).toEqual([
      "Roll Capture.app automatic install failed (release lookup failed: offline); install it manually, then open it once and grant Screen Recording permission.",
    ]);
  });

  it("rejects a size mismatch before extracting", async () => {
    const home = tmp("size-home");
    const result = await installRollCapture(
      deps({
        home,
        downloadAsset: async () => Buffer.from("too large"),
      }),
    );

    expect(result.status).toBe("manual");
    expect(result.reason).toContain("size mismatch");
    expect(existsSync(join(home, "Applications", "Roll Capture.app"))).toBe(false);
  });
});
