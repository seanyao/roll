/**
 * US-ATTEST-006 — `roll attest` composition pins: feature-file resolution,
 * run-dir lifecycle + latest symlink, evidence.json, the ac-map intent hook
 * (absent ⇒ honest all-Claimed), and the never-block failure policy.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { EvidenceRun, ShotRun } from "@roll/infra";
import { attestCommand, findFeatureFile } from "../src/commands/attest.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function project(): string {
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-attest-")));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll", "features", "demo"), { recursive: true });
  writeFileSync(
    join(proj, ".roll", "features", "demo", "FIX-300.md"),
    ["# FIX-300 — demo", "", "**AC:**", "- [ ] 第一条验收", "- [ ] 第二条验收", ""].join("\n"),
  );
  return proj;
}

const quietRun: EvidenceRun = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });

function inDir<T>(proj: string, fn: () => Promise<T>): Promise<T> {
  const save = process.cwd();
  process.chdir(proj);
  return fn().finally(() => process.chdir(save));
}

function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (): boolean => true;
  // @ts-expect-error capture-only
  process.stderr.write = (): boolean => true;
  return fn().finally(() => {
    process.stdout.write = o;
    process.stderr.write = e;
  });
}

const T0 = new Date("2026-06-06T01:02:03");

describe("findFeatureFile", () => {
  it("ID-named file wins over content mentions", () => {
    const proj = project();
    writeFileSync(join(proj, ".roll", "features", "demo", "other.md"), "mentions FIX-300 in prose\n");
    expect(findFeatureFile(proj, "FIX-300")).toContain("FIX-300.md");
  });
  it("missing story → null", () => {
    expect(findFeatureFile(project(), "US-NOPE-9")).toBeNull();
  });
});

describe("attestCommand", () => {
  it("writes evidence.json + report.html under a run dir and points latest at it", async () => {
    const proj = project();
    const code = await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    expect(code).toBe(0);
    const storyDir = join(proj, ".roll", "verification", "FIX-300");
    const runDir = join(storyDir, "2026-06-06T01-02-03");
    expect(existsSync(join(runDir, "evidence.json"))).toBe(true);
    const html = readFileSync(join(runDir, "report.html"), "utf8");
    expect(html).toContain("FIX-300 — Acceptance Evidence");
    expect(lstatSync(join(storyDir, "latest")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(storyDir, "latest"))).toBe("2026-06-06T01-02-03");
  });

  it("no ac-map.json ⇒ every AC honestly Claimed (red line, no invented evidence)", async () => {
    const proj = project();
    await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    const html = readFileSync(
      join(proj, ".roll", "verification", "FIX-300", "2026-06-06T01-02-03", "report.html"),
      "utf8",
    );
    expect(html).toContain("🟧 Claimed 仅声明 × 2");
  });

  it("ac-map.json drives statuses + inline text evidence from the run dir", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "verification", "FIX-300");
    const runDir = join(storyDir, "2026-06-06T01-02-03");
    mkdirSync(join(runDir, "evidence"), { recursive: true });
    writeFileSync(join(runDir, "evidence", "vitest.txt"), "\x1b[32m✓ 8 passed\x1b[0m\n");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        {
          ac: "FIX-300:AC1",
          status: "pass",
          evidence: [{ kind: "text", label: "vitest", textFile: "evidence/vitest.txt" }],
        },
        { ac: "FIX-300:AC2", status: "partial", note: "移动端未验", evidence: [{ kind: "ci", label: "CI", href: "https://ci/1" }] },
      ]),
    );
    await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    const html = readFileSync(join(runDir, "report.html"), "utf8");
    expect(html).toContain("✅ Pass 通过 × 1");
    expect(html).toContain("🟨 Partial 部分满足 × 1");
    expect(html).toContain('<span class="a-fg32">✓ 8 passed</span>');
    expect(html).toContain("移动端未验");
    expect(html).not.toContain("Discrepancies"); // mapped evidence ⇒ no red-line downgrades
  });

  it("US-ATTEST-012 — ac-map fail/blocked statuses flow through to the report", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "verification", "FIX-300");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        { ac: "FIX-300:AC1", status: "fail", evidence: [{ kind: "test-pass", label: "red suite" }] },
        { ac: "FIX-300:AC2", status: "blocked", note: "等 iOS 真机" },
      ]),
    );
    await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    const html = readFileSync(join(storyDir, "2026-06-06T01-02-03", "report.html"), "utf8");
    expect(html).toContain("❌ Fail 未通过 × 1");
    expect(html).toContain("⛔ Blocked 受阻 × 1");
    expect(html).toContain("等 iOS 真机");
    // blocked w/o evidence is NOT a red-line discrepancy (verified-state ≠ 嘴上 claim)
    expect(html).not.toContain("Discrepancies");
  });

  it("re-run lands a second run dir and re-points latest (history preserved)", async () => {
    const proj = project();
    const opts = { run: quietRun, ghProbe: (): Promise<boolean> => Promise.resolve(false) };
    await silenced(() => inDir(proj, () => attestCommand(["FIX-300"], { ...opts, now: () => T0 })));
    const T1 = new Date("2026-06-06T02:00:00");
    await silenced(() => inDir(proj, () => attestCommand(["FIX-300"], { ...opts, now: () => T1 })));
    const storyDir = join(proj, ".roll", "verification", "FIX-300");
    expect(existsSync(join(storyDir, "2026-06-06T01-02-03", "report.html"))).toBe(true);
    expect(readlinkSync(join(storyDir, "latest"))).toBe("2026-06-06T02-00-00");
  });

  it("unknown story → exit 1; missing arg → usage exit 1", async () => {
    const proj = project();
    expect(await silenced(() => inDir(proj, () => attestCommand(["US-NOPE-9"], { run: quietRun })))).toBe(1);
    expect(await silenced(() => inDir(proj, () => attestCommand([], { run: quietRun })))).toBe(1);
  });
});

describe("US-ATTEST-011 — Gate terminal self-capture lane", () => {
  // A GUI macOS host whose screencapture lands real pixels at the out path.
  function guiShot(): ShotRun {
    return (cmd, argv) => {
      if (cmd === "launchctl") return Promise.resolve({ code: 0, stdout: "Aqua\n", stderr: "" });
      if (cmd === "screencapture") {
        writeFileSync(String(argv[argv.length - 1]), "PNGDATA"); // out = last argv
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" }); // osascript etc.
    };
  }

  it("a real GUI cycle self-captures a terminal shot into the report", async () => {
    const proj = project();
    await silenced(() =>
      inDir(proj, () =>
        attestCommand(["FIX-300", "--capture-tmux", "roll-loop-demo"], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          capture: { run: guiShot(), platform: "darwin", env: {} },
        }),
      ),
    );
    const runDir = join(proj, ".roll", "verification", "FIX-300", "2026-06-06T01-02-03");
    expect(existsSync(join(runDir, "screenshots", "terminal.png"))).toBe(true);
    const html = readFileSync(join(runDir, "report.html"), "utf8");
    expect(html).toContain("Gate self-capture · 自产实拍");
    expect(html).toContain('<img src="screenshots/terminal.png"');
  });

  it("a headless host honestly skips — no shot, no self-capture block (deletion contract)", async () => {
    const proj = project();
    await silenced(() =>
      inDir(proj, () =>
        attestCommand(["FIX-300", "--capture-tmux", "roll-loop-demo"], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          capture: { run: guiShot(), platform: "linux", env: {} }, // not macOS → lane skips
        }),
      ),
    );
    const runDir = join(proj, ".roll", "verification", "FIX-300", "2026-06-06T01-02-03");
    expect(existsSync(join(runDir, "screenshots", "terminal.png"))).toBe(false);
    const html = readFileSync(join(runDir, "report.html"), "utf8");
    expect(html).not.toContain("Gate self-capture");
  });

  it("no capture flag ⇒ lane never runs (back-compat: plain attest unchanged)", async () => {
    const proj = project();
    const calls: string[] = [];
    const recorder: ShotRun = (cmd) => {
      calls.push(cmd);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    await silenced(() =>
      inDir(proj, () =>
        attestCommand(["FIX-300"], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          capture: { run: recorder, platform: "darwin", env: {} },
        }),
      ),
    );
    expect(calls).toHaveLength(0); // no flag → dispatcher untouched
  });
});

describe("US-ATTEST-009 — self-score notes feed the report", () => {
  it("same-story notes render in the fold; unrelated stories don't", async () => {
    const proj = project();
    mkdirSync(join(proj, ".roll", "notes"), { recursive: true });
    writeFileSync(
      join(proj, ".roll", "notes", "2026-06-05-roll-fix-FIX-300-1780000000.md"),
      ["---", "skill: roll-fix", "story: FIX-300", "score: 8", "verdict: good", "ts: 2026-06-05T20:00:00Z", "---", "", "干净的一刀。"].join("\n"),
    );
    writeFileSync(
      join(proj, ".roll", "notes", "2026-06-05-roll-fix-FIX-999-1780000001.md"),
      ["---", "skill: roll-fix", "story: FIX-999", "score: 2", "verdict: bad", "ts: 2026-06-05T21:00:00Z", "---", "", "无关条目"].join("\n"),
    );
    await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    const html = readFileSync(
      join(proj, ".roll", "verification", "FIX-300", "2026-06-06T01-02-03", "report.html"),
      "utf8",
    );
    expect(html).toContain("Self-Score · 自评（1）");
    expect(html).toContain("<b>8</b>/10 · good");
    expect(html).toContain("干净的一刀。");
    expect(html).not.toContain("无关条目");
  });
});
