/**
 * US-ATTEST-004 — dispatcher pins: per-surface skip preconditions, the
 * deletion contract (taken:false + reason, never a placeholder), and the
 * "file must be non-empty" truth test over tool exit codes.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  captureAll,
  captureFromMarker,
  captureScreenshot,
  parseCaptureMarker,
  screenshotEvidenceRef,
  type ScreenshotResult,
  type ShotRun,
  type ScreenshotRequest,
} from "../src/screenshot.js";

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
    // bounds queries answer with a window rect so the happy paths proceed
    if (cmd === "osascript" && String(argv[1] ?? "").includes("bounds of w")) {
      return Promise.resolve({ code: 0, stdout: "0, 0, 1280, 800\n", stderr: "" });
    }
    if (cmd === "osascript" && String(argv[1] ?? "").includes("roll-attest-exists-probe")) {
      return Promise.resolve({ code: 0, stdout: "no\n", stderr: "" });
    }
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

describe("terminal", () => {
  // A GUI macOS host: launchctl reports the Aqua session manager.
  const aqua = { code: 0, stdout: "Aqua\n" };

  it("ROLL_ATTEST_NO_TERMINAL=1 skips before any spawn", async () => {
    const { run, calls } = fake({});
    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: { ROLL_ATTEST_NO_TERMINAL: "1" }, platform: "darwin" },
    );
    expect(r).toMatchObject({ taken: false, skipped: "ROLL_ATTEST_NO_TERMINAL=1" });
    expect(calls).toHaveLength(0);
  });

  it("non-macOS skips before any spawn (osascript/screencapture are mac-only)", async () => {
    const { run, calls } = fake({});
    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "linux" },
    );
    expect(r.skipped).toBe("not macOS");
    expect(calls).toHaveLength(0);
  });

  it("US-ATTEST-012 — a command carrying a secret is REFUSED (redact & reshoot), no window opened", async () => {
    const { run, calls } = fake({ launchctl: aqua, osascript: { code: 0 }, screencapture: { code: 0, writes: true } });
    const r = await captureScreenshot(
      { kind: "terminal", command: "curl -H 'Authorization: Bearer ghp_0123456789abcdefghijklmnopqrstuvwxyz'", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );
    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("secret");
    expect(calls).toHaveLength(0); // refused before any spawn — secret never reaches the screen
  });

  it("no GUI session (launchctl not Aqua) → skip, never opens a window", async () => {
    const { run, calls } = fake({ launchctl: { code: 0, stdout: "Background\n" } });
    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );
    expect(r).toMatchObject({ taken: false, skipped: "no GUI session" });
    expect(calls).toEqual(["launchctl managername"]); // probed, then stopped
  });

  it("no screen-recording permission (screencapture fails) → skip with reason", async () => {
    const { run } = fake({ launchctl: aqua, osascript: { code: 0 }, sh: { code: 0 }, screencapture: { code: 1 } });
    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );
    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("permission");
  });

  it("GUI + capture lands non-empty → taken; positions window, runs cmd, closes window", async () => {
    const { run, calls } = fake({
      launchctl: aqua,
      osascript: { code: 0 },
      sh: { code: 0 },
      screencapture: { code: 0, writes: true },
    });
    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );
    expect(r.taken).toBe(true);
    const joined = calls.join("\n");
    expect(joined).toContain("launchctl managername");
    expect(joined).toContain("do script");
    expect(joined).toContain("roll status");
    expect(joined).toContain("screencapture -x -R");
    expect(joined).toContain("roll-attest-exit-tab"); // window retired via shell exit (FIX-272)
  });

  it("FIX-266: command captures wait for the Terminal command to exit before closing", async () => {
    let commandLive = false;
    let unsafeClose = false;
    const calls: string[] = [];
    const run: ShotRun = (cmd, argv) => {
      calls.push(`${cmd} ${argv.join(" ")}`);
      const script = String(argv[1] ?? "");
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "osascript" && script.includes("roll-attest-exit-tab")) {
        if (commandLive) unsafeClose = true; // exiting the shell mid-command is as unsafe as close
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      if (cmd === "osascript" && script.includes("roll-attest-exists-probe")) {
        return Promise.resolve({ code: 0, stdout: "no\n", stderr: "" }); // window collapsed via shellExitAction
      }
      if (cmd === "osascript" && script.includes("do script")) {
        commandLive = true;
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      if (cmd === "osascript" && script.includes("bounds of w")) {
        return Promise.resolve({ code: 0, stdout: "0, 0, 1280, 800\n", stderr: "" });
      }
      if (cmd === "screencapture") {
        writeFileSync(String(argv[argv.length - 1]), "PNG");
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      if (cmd === "sh") {
        execFileSync("sh", ["-n"], { input: script });
        commandLive = false;
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      if (cmd === "osascript" && script.includes("close w saving no")) {
        if (commandLive) unsafeClose = true;
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const r = await captureScreenshot(
      { kind: "terminal", command: "node scripts/proof.js", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );

    expect(r.taken).toBe(true);
    expect(unsafeClose).toBe(false);
    const waitIndex = calls.findIndex((c) => c.startsWith("sh -lc "));
    // FIX-272: teardown is exit-first — the shell dies and the profile's own
    // shellExitAction collapses the window; no AppleScript close needed.
    const exitIndex = calls.findIndex((c) => c.includes("roll-attest-exit-tab"));
    expect(waitIndex).toBeGreaterThan(-1);
    expect(exitIndex).toBeGreaterThan(waitIndex);
    expect(calls.some((c) => c.includes("close w saving no"))).toBe(false);
    const doScript = calls.find((c) => c.includes("do script")) ?? "";
    expect(doScript).toContain("__roll_status"); // sentinel wrapper present
    expect(doScript).not.toMatch(/;\s*exit \\"\$__roll_status\\"/); // FIX-271: no self-closing exit
    expect(doScript).toContain("set custom title");
    expect(calls[exitIndex]).toContain("roll-attest-");
  });

  it("FIX-266: if a command is still running, it leaves the window open instead of prompting macOS to terminate it", async () => {
    let closeCalled = false;
    const calls: string[] = [];
    const run: ShotRun = (cmd, argv) => {
      calls.push(`${cmd} ${argv.join(" ")}`);
      const script = String(argv[1] ?? "");
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "screencapture") {
        writeFileSync(String(argv[argv.length - 1]), "PNG");
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      if (cmd === "sh") {
        execFileSync("sh", ["-n"], { input: script });
        return Promise.resolve({ code: 1, stdout: "", stderr: "timed out" });
      }
      if (cmd === "osascript" && script.includes("close w saving no")) closeCalled = true;
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const r = await captureScreenshot(
      { kind: "terminal", command: "sleep 999", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );

    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("still running");
    expect(closeCalled).toBe(false);
    expect(calls.some((c) => c.startsWith("sh -lc "))).toBe(true);
  });

  it("FIX-271: waits for command exit BEFORE shooting, and shoots the window's actual bounds", async () => {
    const calls: string[] = [];
    const run: ShotRun = (cmd, argv) => {
      calls.push(`${cmd} ${argv.join(" ")}`);
      const script = String(argv[1] ?? "");
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "osascript" && script.includes("bounds of w")) {
        return Promise.resolve({ code: 0, stdout: "100, 50, 900, 650\n", stderr: "" });
      }
      if (cmd === "osascript" && script.includes("roll-attest-exists-probe")) {
        return Promise.resolve({ code: 0, stdout: "no\n", stderr: "" });
      }
      if (cmd === "screencapture") {
        writeFileSync(String(argv[argv.length - 1]), "PNG");
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );

    expect(r.taken).toBe(true);
    const waitIndex = calls.findIndex((c) => c.startsWith("sh -lc "));
    const shotIndex = calls.findIndex((c) => c.startsWith("screencapture "));
    expect(waitIndex).toBeGreaterThan(-1);
    expect(shotIndex).toBeGreaterThan(waitIndex); // exit sentinel first, pixels second
    expect(calls[shotIndex]).toContain("-R 100,50,800,600"); // bounds → origin+size, not the configured rect
  });

  it("FIX-271: still-running command skips WITHOUT shooting (no blank-window evidence)", async () => {
    const calls: string[] = [];
    const run: ShotRun = (cmd, argv) => {
      calls.push(`${cmd} ${argv.join(" ")}`);
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "sh") return Promise.resolve({ code: 1, stdout: "", stderr: "timed out" });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const r = await captureScreenshot(
      { kind: "terminal", command: "sleep 999", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );

    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("still running");
    expect(calls.some((c) => c.startsWith("screencapture "))).toBe(false);
  });

  it("FIX-271: window not found → honest skip, NEVER a blind-region shot", async () => {
    const calls: string[] = [];
    const run: ShotRun = (cmd, argv) => {
      calls.push(`${cmd} ${argv.join(" ")}`);
      const script = String(argv[1] ?? "");
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "osascript" && script.includes("bounds of w")) {
        return Promise.resolve({ code: 0, stdout: "", stderr: "" }); // window vanished
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );

    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("refusing a blind-region shot");
    expect(calls.some((c) => c.startsWith("screencapture "))).toBe(false); // owner's screen never sampled
  });

  it("FIX-271: the exit sentinel path is absolute even when out is relative (Terminal shells start at $HOME)", async () => {
    const calls: string[] = [];
    const run: ShotRun = (cmd, argv) => {
      calls.push(`${cmd} ${argv.join(" ")}`);
      const script = String(argv[1] ?? "");
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "osascript" && script.includes("bounds of w")) {
        return Promise.resolve({ code: 0, stdout: "0, 0, 1280, 800\n", stderr: "" });
      }
      if (cmd === "osascript" && script.includes("roll-attest-exists-probe")) {
        return Promise.resolve({ code: 0, stdout: "no\n", stderr: "" });
      }
      if (cmd === "screencapture") {
        writeFileSync(String(argv[argv.length - 1]), "PNG");
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const rel = "rel-shots/terminal.png";
    mkdirSync("rel-shots", { recursive: true });
    try {
      await captureScreenshot({ kind: "terminal", command: "roll status", out: rel }, { run, env: {}, platform: "darwin" });
      const doScript = calls.find((c) => c.includes("do script")) ?? "";
      const wait = calls.find((c) => c.startsWith("sh -lc ")) ?? "";
      expect(doScript).toContain(`'${process.cwd()}/rel-shots/terminal.png.done'`); // writer side absolute
      expect(wait).toContain(`'${process.cwd()}/rel-shots/terminal.png.done'`); // waiter side absolute
    } finally {
      rmSync("rel-shots", { recursive: true, force: true });
    }
  });

  it("FIX-272: 'never close' profile — window survives the shell exit, fallback close fires", async () => {
    const calls: string[] = [];
    const run: ShotRun = (cmd, argv) => {
      calls.push(`${cmd} ${argv.join(" ")}`);
      const script = String(argv[1] ?? "");
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "osascript" && script.includes("bounds of w")) {
        return Promise.resolve({ code: 0, stdout: "0, 0, 1280, 800\n", stderr: "" });
      }
      if (cmd === "osascript" && script.includes("roll-attest-exists-probe")) {
        return Promise.resolve({ code: 0, stdout: "yes\n", stderr: "" }); // shellExitAction=2 keeps it
      }
      if (cmd === "screencapture") {
        writeFileSync(String(argv[argv.length - 1]), "PNG");
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );

    expect(r.taken).toBe(true);
    const exitIndex = calls.findIndex((c) => c.includes("roll-attest-exit-tab"));
    const closeIndex = calls.findIndex((c) => c.includes("close w saving no"));
    expect(exitIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(exitIndex); // fallback close only after the probe gave up
  }, 15000);

  it("FIX-272: tmux lane never sends `exit` — it would land inside the attached session", async () => {
    const { run, calls } = fake({
      launchctl: { code: 0, stdout: "Aqua\n" },
      osascript: { code: 0 },
      screencapture: { code: 0, writes: true },
    });
    const r = await captureScreenshot(
      { kind: "terminal", tmux: "roll-loop-demo", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );
    expect(r.taken).toBe(true);
    expect(calls.some((c) => c.includes("roll-attest-exit-tab"))).toBe(false);
    expect(calls.some((c) => c.includes("close w saving no"))).toBe(true);
  });

  it("tmux variant attaches the observability session instead of a command", async () => {
    const { run, calls } = fake({
      launchctl: aqua,
      osascript: { code: 0 },
      screencapture: { code: 0, writes: true },
    });
    const r = await captureScreenshot(
      { kind: "terminal", tmux: "roll-loop-roll-d9dfa0", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );
    expect(r.taken).toBe(true);
    expect(calls.join("\n")).toContain("tmux attach -t roll-loop-roll-d9dfa0");
  });

  it("empty capture (screencapture exits 0 but writes nothing) is NOT taken", async () => {
    const { run } = fake({ launchctl: aqua, osascript: { code: 0 }, sh: { code: 0 }, screencapture: { code: 0 } });
    const r = await captureScreenshot(
      { kind: "terminal", command: "roll status", out: outPath() },
      { run, env: {}, platform: "darwin" },
    );
    expect(r.taken).toBe(false);
    expect(r.skipped).toContain("empty capture");
  });
});

describe("screenshotEvidenceRef (deletion-contract bridge)", () => {
  const taken: ScreenshotResult = { kind: "terminal", out: "/x/terminal.png", taken: true };
  const skipped: ScreenshotResult = { kind: "terminal", out: "/x/terminal.png", taken: false, skipped: "no GUI session" };

  it("a TAKEN capture yields a screenshot evidence ref the report can render", () => {
    expect(screenshotEvidenceRef(taken, "../screenshots/terminal.png")).toEqual({
      kind: "screenshot",
      label: "terminal",
      href: "../screenshots/terminal.png",
    });
  });

  it("a SKIPPED capture yields null — no placeholder ref reaches the report", () => {
    expect(screenshotEvidenceRef(skipped, "../screenshots/terminal.png")).toBeNull();
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

describe("US-EVID-003 capture markers", () => {
  it("parses the agent stdout marker protocol", () => {
    expect(parseCaptureMarker("::roll-capture before web home https://app.test")).toEqual({
      phase: "before",
      kind: "web",
      stem: "home",
      target: "https://app.test",
    });
    expect(parseCaptureMarker("::roll-capture gate terminal cli tmux:roll-loop-demo")).toEqual({
      phase: "gate",
      kind: "terminal",
      stem: "cli",
      target: "tmux:roll-loop-demo",
    });
    expect(parseCaptureMarker("noise")).toBeNull();
    expect(parseCaptureMarker("::roll-capture before web ../bad https://x")).toBeNull();
  });

  it("captures before/after web shots into the run frame screenshots dir", async () => {
    const runDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-marker-run-")));
    dirs.push(runDir);
    const { run, calls } = fake({ npx: { code: 0, writes: true } });

    const before = await captureFromMarker(
      { phase: "before", kind: "web", stem: "home", target: "https://app.test" },
      { runDir, deps: { run, env: {} } },
    );
    const after = await captureFromMarker(
      { phase: "after", kind: "web", stem: "home", target: "https://app.test" },
      { runDir, deps: { run, env: {} } },
    );

    expect(before.taken).toBe(true);
    expect(after.taken).toBe(true);
    expect(existsSync(join(runDir, "screenshots", "before-home.png"))).toBe(true);
    expect(existsSync(join(runDir, "screenshots", "after-home.png"))).toBe(true);
    expect(calls.join("\n")).toContain("playwright@latest screenshot https://app.test");
  });

  it("captures terminal gate markers through tmux into the same screenshots dir", async () => {
    const runDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-marker-terminal-")));
    dirs.push(runDir);
    const { run, calls } = fake({
      launchctl: { code: 0, stdout: "Aqua\n" },
      osascript: { code: 0 },
      screencapture: { code: 0, writes: true },
    });

    const res = await captureFromMarker(
      { phase: "gate", kind: "terminal", stem: "cli", target: "tmux:roll-loop-demo" },
      { runDir, deps: { run, env: {}, platform: "darwin" } },
    );

    expect(res.taken).toBe(true);
    expect(existsSync(join(runDir, "screenshots", "gate-cli.png"))).toBe(true);
    expect(calls.join("\n")).toContain("tmux attach -t roll-loop-demo");
  });

  it("honestly skips when the surface cannot capture; no placeholder file is written", async () => {
    const runDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-marker-skip-")));
    dirs.push(runDir);
    const { run } = fake({});
    const res = await captureFromMarker(
      { phase: "gate", kind: "terminal", stem: "cli", target: "tmux:roll-loop-demo" },
      { runDir, deps: { run, env: {}, platform: "linux" } },
    );

    expect(res.taken).toBe(false);
    expect(res.skipped).toBe("not macOS");
    expect(existsSync(join(runDir, "screenshots", "gate-cli.png"))).toBe(false);
  });
});
