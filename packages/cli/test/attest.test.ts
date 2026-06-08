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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { EvidenceRun, ShotRun } from "@roll/infra";
import { bi } from "@roll/core";
import { attestCommand, buildCardContext, detectAfterOnly, detectBeforeAfter, findFeatureFile, readBacklogRow } from "../src/commands/attest.js";
import { renderStoryPage } from "../src/lib/story-page.js";

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
  it("FIX-225: story-dir <ID>/spec.md wins over a prose mention walked earlier", () => {
    const proj = project();
    // The hijack case: an alphabetically-earlier epic mentions the ID in prose.
    mkdirSync(join(proj, ".roll", "features", "aa-epic"), { recursive: true });
    writeFileSync(join(proj, ".roll", "features", "aa-epic", "other.md"), "mentions FIX-400 in prose\n");
    mkdirSync(join(proj, ".roll", "features", "demo", "FIX-400"), { recursive: true });
    writeFileSync(join(proj, ".roll", "features", "demo", "FIX-400", "spec.md"), "# FIX-400\n\n**AC:**\n- [ ] x\n");
    expect(findFeatureFile(proj, "FIX-400")).toContain(join("demo", "FIX-400", "spec.md"));
  });
});

describe("attestCommand", () => {
  it("writes evidence.json + report.html under a run dir and points latest at it", async () => {
    const proj = project();
    const code = await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    expect(code).toBe(0);
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    const runDir = join(storyDir, "2026-06-06T01-02-03");
    expect(existsSync(join(runDir, "evidence.json"))).toBe(true);
    const html = readFileSync(join(runDir, "FIX-300-report.html"), "utf8");
    expect(html).toContain("FIX-300 — Acceptance Evidence");
    expect(lstatSync(join(storyDir, "latest")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(storyDir, "latest"))).toBe("2026-06-06T01-02-03");
  });

  it("US-EVID-001: --run-dir reuses an already-opened evidence frame and points latest at it", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    const runDir = join(storyDir, "cycle-20260608-001");
    mkdirSync(join(runDir, "evidence"), { recursive: true });
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    writeFileSync(join(runDir, "evidence", "kept.txt"), "pre-spawn proof\n");

    const code = await silenced(() =>
      inDir(proj, () =>
        attestCommand(["FIX-300", "--run-dir", runDir], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) }),
      ),
    );

    expect(code).toBe(0);
    expect(readFileSync(join(runDir, "evidence", "kept.txt"), "utf8")).toBe("pre-spawn proof\n");
    expect(existsSync(join(runDir, "evidence.json"))).toBe(true);
    expect(existsSync(join(runDir, "FIX-300-report.html"))).toBe(true);
    expect(readlinkSync(join(storyDir, "latest"))).toBe("cycle-20260608-001");
  });

  it("US-EVID-005: --run-dir from a main-checkout .roll stays resolvable through a worktree .roll symlink", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    const runDir = join(storyDir, "cycle-symlink");
    const worktree = realpathSync(mkdtempSync(join(tmpdir(), "roll-attest-wt-")));
    dirs.push(worktree);
    symlinkSync(join(proj, ".roll"), join(worktree, ".roll"));

    const code = await silenced(() =>
      inDir(worktree, () =>
        attestCommand(["FIX-300", "--run-dir", runDir], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) }),
      ),
    );

    expect(code).toBe(0);
    const latest = join(storyDir, "latest");
    expect(lstatSync(latest).isSymbolicLink()).toBe(true);
    expect(readlinkSync(latest)).toBe("cycle-symlink");
    expect(existsSync(join(latest, "FIX-300-report.html"))).toBe(true);
  });

  it("US-EVID-001: ROLL_RUN_DIR is the backward-compatible frame handoff for loop agents", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    const runDir = join(storyDir, "cycle-env");
    mkdirSync(join(runDir, "evidence"), { recursive: true });
    const previous = process.env["ROLL_RUN_DIR"];
    process.env["ROLL_RUN_DIR"] = runDir;
    try {
      const code = await silenced(() =>
        inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
      );
      expect(code).toBe(0);
    } finally {
      if (previous === undefined) delete process.env["ROLL_RUN_DIR"];
      else process.env["ROLL_RUN_DIR"] = previous;
    }
    expect(existsSync(join(runDir, "FIX-300-report.html"))).toBe(true);
    expect(readlinkSync(join(storyDir, "latest"))).toBe("cycle-env");
  });

  it("US-EVID-004: attest refreshes an existing card dossier delivery phase", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(
      join(storyDir, "index.html"),
      renderStoryPage({ id: "FIX-300", title: "demo", created: "2026-06-06", type: "fix", epic: "demo" }),
      "utf8",
    );

    const code = await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );

    expect(code).toBe(0);
    const html = readFileSync(join(storyDir, "index.html"), "utf8");
    expect(html).toContain('class="phase phase-done" data-phase="delivery"');
    expect(html).toContain("2026-06-06T01-02-03/FIX-300-report.html");
    expect(html).not.toContain("Not yet delivered");
  });

  it("US-EVID-004: card dossier delivery phase renders before/after pairs and after-only shots", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    const runDir = join(storyDir, "cycle-visuals");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    writeFileSync(join(runDir, "screenshots", "before-home.png"), "PNG");
    writeFileSync(join(runDir, "screenshots", "after-home.png"), "PNG");
    writeFileSync(join(runDir, "screenshots", "after-new-panel.png"), "PNG");
    writeFileSync(
      join(storyDir, "index.html"),
      renderStoryPage({ id: "FIX-300", title: "demo", created: "2026-06-06", type: "fix", epic: "demo" }),
      "utf8",
    );

    const code = await silenced(() =>
      inDir(proj, () =>
        attestCommand(["FIX-300", "--run-dir", runDir], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) }),
      ),
    );

    expect(code).toBe(0);
    const html = readFileSync(join(storyDir, "index.html"), "utf8");
    expect(html).toContain('class="delivery-shot-pair"');
    expect(html).toContain("cycle-visuals/screenshots/before-home.png");
    expect(html).toContain("cycle-visuals/screenshots/after-home.png");
    expect(html).toContain('class="delivery-shot-single"');
    expect(html).toContain("cycle-visuals/screenshots/after-new-panel.png");
    expect(html).not.toContain("before-new-panel.png");
  });

  it("no ac-map.json ⇒ every AC honestly Claimed (red line, no invented evidence)", async () => {
    const proj = project();
    await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    const html = readFileSync(
      join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03", "FIX-300-report.html"),
      "utf8",
    );
    expect(html).toContain(`🟧 ${bi("Claimed", "仅声明")} × 2`);
  });

  it("ac-map.json drives statuses + inline text evidence from the run dir", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
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
    const html = readFileSync(join(runDir, "FIX-300-report.html"), "utf8");
    expect(html).toContain(`✅ ${bi("Pass", "通过")} × 1`);
    expect(html).toContain(`🟨 ${bi("Partial", "部分满足")} × 1`);
    expect(html).toContain('<span class="a-fg32">✓ 8 passed</span>');
    expect(html).toContain("移动端未验");
    expect(html).not.toContain("Discrepancies"); // mapped evidence ⇒ no red-line downgrades
  });

  it("US-META-001 — ac-map read-compat: a legacy verification/<ID>/ac-map.json still drives statuses", async () => {
    const proj = project();
    // No card-folder ac-map; only the legacy location (as the un-migrated Gate writes it).
    const legacy = join(proj, ".roll", "verification", "FIX-300");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(
      join(legacy, "ac-map.json"),
      JSON.stringify([{ ac: "FIX-300:AC1", status: "blocked", note: "等下游" }]),
    );
    await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    // Report lands in the NEW card folder, but honoured the LEGACY ac-map.
    const html = readFileSync(
      join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03", "FIX-300-report.html"),
      "utf8",
    );
    expect(html).toContain(`⛔ ${bi("Blocked", "受阻")}`);
  });

  it("US-ATTEST-012 — ac-map fail/blocked statuses flow through to the report", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
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
    const html = readFileSync(join(storyDir, "2026-06-06T01-02-03", "FIX-300-report.html"), "utf8");
    expect(html).toContain(`❌ ${bi("Fail", "未通过")} × 1`);
    expect(html).toContain(`⛔ ${bi("Blocked", "受阻")} × 1`);
    expect(html).toContain("等 iOS 真机");
    // blocked w/o evidence is NOT a red-line discrepancy (verified-state ≠ 嘴上 claim)
    expect(html).not.toContain("Discrepancies");
  });

  it("US-ATTEST-012 — text evidence carrying a secret is masked before it lands in the report + WARN留痕", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    const runDir = join(storyDir, "2026-06-06T01-02-03");
    mkdirSync(join(runDir, "evidence"), { recursive: true });
    const secret = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    writeFileSync(join(runDir, "evidence", "log.txt"), `deploy ok\ntoken=${secret}\n`);
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        { ac: "FIX-300:AC1", status: "pass", evidence: [{ kind: "text", label: "log", textFile: "evidence/log.txt" }] },
      ]),
    );
    const errs: string[] = [];
    const oErr = process.stderr.write.bind(process.stderr);
    const oOut = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stderr.write = (s: string): boolean => (errs.push(String(s)), true);
    // @ts-expect-error quiet stdout
    process.stdout.write = (): boolean => true;
    try {
      await inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) }));
    } finally {
      process.stderr.write = oErr;
      process.stdout.write = oOut;
    }
    const html = readFileSync(join(runDir, "FIX-300-report.html"), "utf8");
    expect(html).not.toContain(secret);
    expect(html).toContain("«REDACTED");
    expect(errs.join("")).toMatch(/redact/i); // 留痕: never silent
  });

  it("US-ATTEST-012 — a report with a broken img reference exits non-zero (render smoke)", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    mkdirSync(storyDir, { recursive: true });
    // ac-map references a screenshot that was never captured → broken <img>.
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        { ac: "FIX-300:AC1", status: "pass", evidence: [{ kind: "screenshot", label: "首页", href: "screenshots/ghost.png" }] },
      ]),
    );
    const code = await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    expect(code).not.toBe(0); // broken reference → non-zero
    // report is still written (evidence preserved) even though the smoke failed
    expect(existsSync(join(storyDir, "2026-06-06T01-02-03", "FIX-300-report.html"))).toBe(true);
  });

  it("US-ATTEST-012 — a report whose img IS present passes smoke (exit 0)", async () => {
    const proj = project();
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    const runDir = join(storyDir, "2026-06-06T01-02-03");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    writeFileSync(join(runDir, "screenshots", "home.png"), "PNGDATA");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        { ac: "FIX-300:AC1", status: "pass", evidence: [{ kind: "screenshot", label: "首页", href: "screenshots/home.png" }] },
      ]),
    );
    const code = await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    expect(code).toBe(0);
  });

  it("re-run lands a second run dir and re-points latest (history preserved)", async () => {
    const proj = project();
    const opts = { run: quietRun, ghProbe: (): Promise<boolean> => Promise.resolve(false) };
    await silenced(() => inDir(proj, () => attestCommand(["FIX-300"], { ...opts, now: () => T0 })));
    const T1 = new Date("2026-06-06T02:00:00");
    await silenced(() => inDir(proj, () => attestCommand(["FIX-300"], { ...opts, now: () => T1 })));
    const storyDir = join(proj, ".roll", "features", "demo", "FIX-300");
    expect(existsSync(join(storyDir, "2026-06-06T01-02-03", "FIX-300-report.html"))).toBe(true);
    expect(readlinkSync(join(storyDir, "latest"))).toBe("2026-06-06T02-00-00");
  });

  it("unknown story → exit 1; missing arg → usage exit 1", async () => {
    const proj = project();
    expect(await silenced(() => inDir(proj, () => attestCommand(["US-NOPE-9"], { run: quietRun })))).toBe(1);
    expect(await silenced(() => inDir(proj, () => attestCommand([], { run: quietRun })))).toBe(1);
  });
});

describe("US-ATTEST-013 — self-contained card context wiring", () => {
  it("readBacklogRow pulls description + status, ID-anchored", () => {
    const proj = project();
    writeFileSync(
      join(proj, ".roll", "backlog.md"),
      ["| Story | Description | Status |", "|--|--|--|", "| FIX-300 | demo 卡一句话 depends-on:FIX-1 | 🔨 In Progress |", ""].join("\n"),
    );
    const row = readBacklogRow(proj, "FIX-300");
    expect(row.description).toContain("demo 卡一句话");
    expect(row.status).toBe("🔨 In Progress");
  });

  it("buildCardContext assembles one-liner / epic / summary / status / cycle id", () => {
    const proj = project();
    writeFileSync(
      join(proj, ".roll", "backlog.md"),
      ["| FIX-300 | 业务一句话 depends-on:FIX-1 | 🔨 In Progress |"].join("\n"),
    );
    // overwrite the feature file with a blockquote goal
    writeFileSync(
      join(proj, ".roll", "features", "demo", "FIX-300.md"),
      ["# FIX-300 — demo", "", "> 这是规格摘要", "> 第二行", "", "**AC:**", "- [ ] x", ""].join("\n"),
    );
    const ctx = buildCardContext(proj, join(proj, ".roll", "features", "demo", "FIX-300.md"), "FIX-300", {
      LOOP_CYCLE_ID: "cycle-xyz",
    });
    expect(ctx?.oneLiner).toBe("业务一句话"); // depends-on stripped
    expect(ctx?.epic).toBe("demo");
    expect(ctx?.summary).toBe("这是规格摘要 第二行");
    expect(ctx?.backlogStatus).toBe("🔨 In Progress");
    expect(ctx?.delivery?.cycleId).toBe("cycle-xyz");
  });

  it("detectBeforeAfter pairs before-/after- shots by stem; unmatched ignored", () => {
    const proj = project();
    const runDir = join(proj, ".roll", "features", "demo", "FIX-300", "run");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    for (const f of ["before-home.png", "after-home.png", "before-orphan.png", "after-lonely.png", "noise.png"]) {
      writeFileSync(join(runDir, "screenshots", f), "PNG");
    }
    const pairs = detectBeforeAfter(runDir);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.label).toBe("home");
    expect(pairs[0]?.before.href).toBe("screenshots/before-home.png");
    expect(pairs[0]?.after.href).toBe("screenshots/after-home.png");
    const afterOnly = detectAfterOnly(runDir);
    expect(afterOnly).toHaveLength(1);
    expect(afterOnly[0]?.label).toBe("lonely");
    expect(afterOnly[0]?.shot.href).toBe("screenshots/after-lonely.png");
  });

  it("attest renders the card-context section end to end", async () => {
    const proj = project();
    writeFileSync(join(proj, ".roll", "backlog.md"), "| FIX-300 | 端到端一句话 | 🔨 In Progress |\n");
    await silenced(() =>
      inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) })),
    );
    const html = readFileSync(
      join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03", "FIX-300-report.html"),
      "utf8",
    );
    expect(html).toContain(bi("Context", "卡上下文"));
    expect(html).toContain("端到端一句话");
    expect(html).toContain("Backlog：🔨 In Progress");
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
    const runDir = join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03");
    expect(existsSync(join(runDir, "screenshots", "terminal.png"))).toBe(true);
    const html = readFileSync(join(runDir, "FIX-300-report.html"), "utf8");
    expect(html).toContain(bi("Gate self-capture", "Gate 自产实拍"));
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
    const runDir = join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03");
    expect(existsSync(join(runDir, "screenshots", "terminal.png"))).toBe(false);
    const html = readFileSync(join(runDir, "FIX-300-report.html"), "utf8");
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
      join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03", "FIX-300-report.html"),
      "utf8",
    );
    expect(html).toContain(`${bi("Self-Score", "自评")}（1）`);
    expect(html).toContain("<b>8</b>/10 · good");
    expect(html).toContain("干净的一刀。");
    expect(html).not.toContain("无关条目");
  });
});

// ── US-ATTEST-014 — process trace wiring ────────────────────────────────────
import { resolveStoryCycle, scopeCycleEvents } from "../src/commands/attest.js";
import type { RollEvent } from "@roll/spec";

describe("resolveStoryCycle", () => {
  const runs = [
    { run_id: "c1", story_id: "FIX-300", cycle_id: "c1", agent: "claude", built: ["FIX-300"] },
    { run_id: "c2", story_id: "US-X-9", cycle_id: "c2", agent: "kimi", built: ["US-X-9"] },
  ];
  it("finds the cycle + agent for a story by story_id", () => {
    const r = resolveStoryCycle(runs, "FIX-300");
    expect(r.found).toBe(true);
    expect(r.cycleId).toBe("c1");
    expect(r.agent).toBe("claude");
  });
  it("matches via the built[] array too", () => {
    expect(resolveStoryCycle([{ run_id: "z", cycle_id: "z", built: ["US-ATTEST-014"] }], "US-ATTEST-014").cycleId).toBe("z");
  });
  it("picks the latest matching row when a story was rebuilt", () => {
    const dup = [...runs, { run_id: "c9", story_id: "FIX-300", cycle_id: "c9", agent: "pi", built: ["FIX-300"] }];
    expect(resolveStoryCycle(dup, "FIX-300").cycleId).toBe("c9");
  });
  it("no match ⇒ found:false", () => {
    expect(resolveStoryCycle(runs, "NOPE").found).toBe(false);
  });
});

describe("scopeCycleEvents", () => {
  const evs: RollEvent[] = [
    { type: "cycle:start", cycleId: "c1", storyId: "FIX-300", agent: "claude", model: "m", ts: 100 },
    { type: "cycle:tcr", cycleId: "c1", commitHash: "aa", message: "tcr: x", ts: 110 },
    { type: "cycle:tcr", cycleId: "OTHER", commitHash: "bb", message: "tcr: foreign", ts: 111 },
    { type: "pr:open", prNumber: 7, storyId: "FIX-300", ts: 120 },
    { type: "ci:pass", prNumber: 7, ts: 130 },
    { type: "ci:fail", prNumber: 99, failSummary: "other story pr", ts: 131 },
    { type: "pr:merge", prNumber: 7, storyId: "FIX-300", ts: 140 },
    { type: "alert:notify", channel: "x", message: "unattributable", ts: 150 },
  ];
  it("keeps this cycle's lifecycle/tcr + the story's PR and its CI, drops foreign", () => {
    const scoped = scopeCycleEvents(evs, "c1", "FIX-300");
    const types = scoped.map((e) => e.type);
    expect(types).toContain("cycle:start");
    expect(types).toContain("cycle:tcr"); // c1's
    expect(scoped.some((e) => e.type === "cycle:tcr" && (e as { message: string }).message.includes("foreign"))).toBe(false);
    expect(types).toContain("pr:open");
    expect(types).toContain("ci:pass"); // PR #7 → in story's pr set
    expect(scoped.some((e) => e.type === "ci:fail")).toBe(false); // PR #99 not the story's
    expect(scoped.some((e) => e.type === "alert:notify")).toBe(false); // unattributable
  });
  it("manual (no cycleId) keeps only story-scoped PR/CI", () => {
    const scoped = scopeCycleEvents(evs, undefined, "FIX-300");
    expect(scoped.every((e) => ["pr:open", "pr:merge", "ci:pass"].includes(e.type))).toBe(true);
  });
});

describe("attestCommand — process trace inline (US-ATTEST-014)", () => {
  // Pin the runtime dir to the temp project so the default reader can't fall
  // through to a real .roll/loop when the suite runs inside the loop itself.
  function withRuntimeEnv<T>(proj: string, fn: () => Promise<T>): Promise<T> {
    const save = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    process.env["ROLL_PROJECT_RUNTIME_DIR"] = join(proj, ".roll", "loop");
    return fn().finally(() => {
      if (save === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = save;
    });
  }
  function writeRuntime(proj: string, opts: { transcript?: string } = {}): void {
    const rt = join(proj, ".roll", "loop");
    mkdirSync(join(rt, "cycle-logs"), { recursive: true });
    writeFileSync(
      join(rt, "runs.jsonl"),
      JSON.stringify({ run_id: "cyc-1", story_id: "FIX-300", cycle_id: "cyc-1", agent: "claude", built: ["FIX-300"] }) + "\n",
    );
    const evs: RollEvent[] = [
      { type: "cycle:start", cycleId: "cyc-1", storyId: "FIX-300", agent: "claude", model: "opus", ts: 1000 },
      { type: "cycle:tcr", cycleId: "cyc-1", commitHash: "deadbeef00", message: "tcr: first step", ts: 1030 },
      { type: "pr:open", prNumber: 42, storyId: "FIX-300", ts: 1060 },
      { type: "cycle:end", cycleId: "cyc-1", outcome: "delivered", cost: { cycleId: "cyc-1", agent: "claude", model: "opus", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 1200 },
    ];
    writeFileSync(join(rt, "events.ndjson"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
    if (opts.transcript !== undefined) writeFileSync(join(rt, "cycle-logs", "cyc-1.agent.log"), opts.transcript);
  }

  it("loop-delivered card: report carries timeline + signal + folded transcript, secrets redacted", async () => {
    const proj = project();
    writeRuntime(proj, { transcript: "starting cycle\nexport GITHUB_TOKEN=ghp_0123456789abcdef0123456789abcdef0123\ndone\n" });
    const code = await silenced(() =>
      withRuntimeEnv(proj, () => inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) }))),
    );
    expect(code).toBe(0);
    const html = readFileSync(join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03", "FIX-300-report.html"), "utf8");
    expect(html).toContain(bi("Process trace", "过程档案"));
    expect(html).toContain("cyc-1");
    expect(html).toContain("first step"); // tcr signal
    expect(html).toContain("完整转录"); // folded transcript present
    expect(html).toContain("cycle-logs/cyc-1.agent.log"); // machine-original index
    // AC2: the secret went through 012's redaction pipeline before inlining
    expect(html).not.toContain("ghp_0123456789abcdef0123456789abcdef0123");
  });

  it("no process data ⇒ section trimmed, exit 0, no throw (degrade path)", async () => {
    const proj = project(); // no .roll/loop runtime written
    const code = await silenced(() =>
      withRuntimeEnv(proj, () => inDir(proj, () => attestCommand(["FIX-300"], { now: () => T0, run: quietRun, ghProbe: () => Promise.resolve(false) }))),
    );
    expect(code).toBe(0);
    const html = readFileSync(join(proj, ".roll", "features", "demo", "FIX-300", "2026-06-06T01-02-03", "FIX-300-report.html"), "utf8");
    expect(html).not.toContain("过程档案");
  });
});
