/**
 * US-ATTEST-004 — dispatcher pins: per-surface skip preconditions, the
 * deletion contract (taken:false + reason, never a placeholder), and the
 * "file must be non-empty" truth test over tool exit codes.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { captureAll, captureScreenshot, type ShotRun, type ScreenshotRequest } from "../src/screenshot.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});
function outPath(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "roll-shot-")));
  dirs.push(d);
  return join(d, "shot.png");
}

/** Fake runner: canned outputs by cmd; optionally writes the capture file. */
function fake(byCmd: Record<string, { code: number; stdout?: string; writes?: boolean }>): {
  run: ShotRun;
  calls: string[];
} {
  const calls: string[] = [];
  const run: ShotRun = (cmd, argv) => {
    calls.push(`${cmd} ${argv.join(" ")}`);
    const c = byCmd[cmd] ?? { code: 1 };
    if (c.writes === true) {
      const out = cmd === "sh" ? /> '(.+)'$/.exec(argv[1] ?? "")?.[1] : argv[argv.length - 1];
      if (out !== undefined) writeFileSync(out, "PNG");
    }
    return Promise.resolve({ code: c.code, stdout: c.stdout ?? "", stderr: "" });
  };
  return { run, calls };
}

describe("web", () => {
  it("captures via npx playwright; taken only when the file lands non-empty", async () => {
    const { run, calls } = fake({ npx: { code: 0, writes: true } });
    const r = await captureScreenshot({ kind: "web", url: "https://x", out: outPath() }, { run, env: {} });
    expect(r.taken).toBe(true);
    expect(calls[0]).toContain("playwright@latest screenshot https://x");
  });

  it("ROLL_ATTEST_NO_BROWSER=1 skips before any spawn", async () => {
    const { run, calls } = fake({});
    const r = await captureScreenshot(
      { kind: "web", url: "https://x", out: outPath() },
      { run, env: { ROLL_ATTEST_NO_BROWSER: "1" } },
    );
    expect(r).toMatchObject({ taken: false, skipped: "ROLL_ATTEST_NO_BROWSER=1" });
    expect(calls).toHaveLength(0);
  });

  it("npx unavailable → skip reason, no throw", async () => {
    const { run } = fake({ npx: { code: 127 } });
    const r = await captureScreenshot({ kind: "web", url: "https://x", out: outPath() }, { run, env: {} });
    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("playwright");
  });

  it("zero-byte capture is NOT taken (exit codes lie)", async () => {
    const { run } = fake({ npx: { code: 0 } }); // exits 0 but writes nothing
    const r = await captureScreenshot({ kind: "web", url: "https://x", out: outPath() }, { run, env: {} });
    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("empty capture");
  });
});

describe("mobile-ios", () => {
  it("non-macOS skips before any spawn", async () => {
    const { run, calls } = fake({});
    const r = await captureScreenshot({ kind: "mobile-ios", out: outPath() }, { run, platform: "linux" });
    expect(r.skipped).toBe("not macOS");
    expect(calls).toHaveLength(0);
  });

  it("no booted simulator → skip; booted → capture", async () => {
    const none = fake({ xcrun: { code: 0, stdout: "== Devices ==\n" } });
    const r1 = await captureScreenshot({ kind: "mobile-ios", out: outPath() }, { run: none.run, platform: "darwin" });
    expect(r1.skipped).toBe("no booted simulator");

    const booted = fake({ xcrun: { code: 0, stdout: "iPhone 16 (ABC) (Booted)", writes: true } });
    const r2 = await captureScreenshot({ kind: "mobile-ios", out: outPath() }, { run: booted.run, platform: "darwin" });
    expect(r2.taken).toBe(true);
  });
});

describe("mobile-android", () => {
  it("no connected device → skip; connected → sh-redirect capture", async () => {
    const empty = fake({ adb: { code: 0, stdout: "List of devices attached\n\n" } });
    const r1 = await captureScreenshot({ kind: "mobile-android", out: outPath() }, { run: empty.run });
    expect(r1.skipped).toBe("no adb device connected");

    const dev = fake({
      adb: { code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n" },
      sh: { code: 0, writes: true },
    });
    const r2 = await captureScreenshot({ kind: "mobile-android", out: outPath() }, { run: dev.run });
    expect(r2.taken).toBe(true);
    expect(dev.calls[1]).toContain("screencap -p >");
  });

  it("adb absent (runner fails) → skip, never throw", async () => {
    const { run } = fake({});
    const r = await captureScreenshot({ kind: "mobile-android", out: outPath() }, { run });
    expect(r.taken).toBe(false);
  });
});

describe("captureAll", () => {
  it("keeps request order and never aborts on skips", async () => {
    const { run } = fake({ npx: { code: 0, writes: true } });
    const reqs: ScreenshotRequest[] = [
      { kind: "mobile-ios", out: outPath() },
      { kind: "web", url: "https://x", out: outPath() },
    ];
    const rs = await captureAll(reqs, { run, env: {}, platform: "linux" });
    expect(rs.map((r) => r.taken)).toEqual([false, true]);
  });
});
