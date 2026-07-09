/**
 * US-ATTEST-003 — evidence collector pins. All process seams faked through the
 * injectable runner (argv recorded); fs fixtures for proof/artifacts. The
 * collector's contract: facts only, never throws, absent shapes over errors.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectEvidence, writeEvidenceJson, type EvidenceRun, type RunOut } from "../src/evidence.js";
import { openEvidenceFrame } from "../src/evidence.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});
function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-ev-${tag}-`)));
  dirs.push(d);
  return d;
}

const NOW = "2026-06-06T00:00:00.000Z";

function fakeRun(canned: Partial<Record<string, RunOut>>): { run: EvidenceRun; calls: string[] } {
  const calls: string[] = [];
  const run: EvidenceRun = (tool, argv) => {
    calls.push(`${tool} ${argv.join(" ")}`);
    return Promise.resolve(canned[tool] ?? { code: 1, stdout: "", stderr: "" });
  };
  return { run, calls };
}

describe("collectEvidence", () => {
  it("TCR commits: tcr-grepped log filtered to subjects naming the story", async () => {
    const { run } = fakeRun({
      git: {
        code: 0,
        stdout: [
          "aaa1\ttcr: FIX-200 修正偏移",
          "bbb2\ttcr: US-OTHER-001 unrelated",
          "ccc3\ttcr: FIX-200 第二刀",
          "",
        ].join("\n"),
        stderr: "",
      },
    });
    const m = await collectEvidence({
      storyId: "FIX-200",
      projectPath: tmp("p"),
      runDir: tmp("r"),
      now: () => NOW,
      run,
      ghProbe: () => Promise.resolve(false),
    });
    expect(m.tcr_commits).toEqual([
      { hash: "aaa1", subject: "tcr: FIX-200 修正偏移" },
      { hash: "ccc3", subject: "tcr: FIX-200 第二刀" },
    ]);
    expect(m.ci.available).toBe(false);
  });

  it("CI: gh present → url+conclusion; malformed json degrades to unavailable", async () => {
    const { run } = fakeRun({
      git: { code: 0, stdout: "", stderr: "" },
      gh: { code: 0, stdout: '[{"url":"https://ci/run/1","conclusion":"success"}]', stderr: "" },
    });
    const m = await collectEvidence({
      storyId: "X-1",
      projectPath: tmp("p"),
      runDir: tmp("r"),
      now: () => NOW,
      run,
      ghProbe: () => Promise.resolve(true),
    });
    expect(m.ci).toEqual({ available: true, url: "https://ci/run/1", conclusion: "success" });
  });

  it("deploy probe: HEAD status classifies ok; absent url → null", async () => {
    const { run, calls } = fakeRun({
      git: { code: 0, stdout: "", stderr: "" },
      curl: { code: 0, stdout: "302", stderr: "" },
    });
    const base = { storyId: "X-1", projectPath: tmp("p"), runDir: tmp("r"), now: () => NOW, run, ghProbe: () => Promise.resolve(false) };
    const probed = await collectEvidence({ ...base, deployUrl: "https://app.example" });
    expect(probed.deploy).toEqual({ url: "https://app.example", status: 302, ok: true });
    expect(calls.some((c) => c.startsWith("curl -sI"))).toBe(true);

    const skipped = await collectEvidence(base);
    expect(skipped.deploy).toBeNull();
  });

  it("test-pass proof: presence + age from mtime vs injected clock", async () => {
    const proj = tmp("p");
    mkdirSync(join(proj, ".roll"), { recursive: true });
    const proof = join(proj, ".roll", "last-test-pass");
    writeFileSync(proof, "vitest\n");
    const mtime = new Date(Date.parse(NOW) - 90_000); // 90s before NOW
    utimesSync(proof, mtime, mtime);
    const { run } = fakeRun({ git: { code: 0, stdout: "", stderr: "" } });
    const m = await collectEvidence({
      storyId: "X-1",
      projectPath: proj,
      runDir: tmp("r"),
      now: () => NOW,
      run,
      ghProbe: () => Promise.resolve(false),
    });
    expect(m.test_pass.present).toBe(true);
    expect(m.test_pass.age_seconds).toBe(90);
  });

  it("artifacts: screenshots/*.png and evidence/*.txt listed sorted, rel paths", async () => {
    const runDir = tmp("r");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    mkdirSync(join(runDir, "evidence"), { recursive: true });
    writeFileSync(join(runDir, "screenshots", "b.png"), "");
    writeFileSync(join(runDir, "screenshots", "a.png"), "");
    writeFileSync(join(runDir, "screenshots", "skip.txt"), "");
    writeFileSync(join(runDir, "evidence", "curl.txt"), "");
    const { run } = fakeRun({ git: { code: 0, stdout: "", stderr: "" } });
    const m = await collectEvidence({
      storyId: "X-1",
      projectPath: tmp("p"),
      runDir,
      now: () => NOW,
      run,
      ghProbe: () => Promise.resolve(false),
    });
    expect(m.screenshots).toEqual(["screenshots/a.png", "screenshots/b.png"]);
    expect(m.texts).toEqual(["evidence/curl.txt"]);
  });

  it("passes capture failed/error metadata through to the manifest", async () => {
    const { run } = fakeRun({ git: { code: 0, stdout: "", stderr: "" } });
    const m = await collectEvidence({
      storyId: "US-EVID-023",
      projectPath: tmp("p"),
      runDir: tmp("r"),
      now: () => NOW,
      run,
      ghProbe: () => Promise.resolve(false),
      captures: [
        {
          kind: "web",
          out: "screenshots/web.png",
          taken: false,
          skipped: "capture errored: headless timeout",
          failed: true,
          error: "headless timeout",
        },
      ],
    });
    expect(m.captures[0]).toMatchObject({
      taken: false,
      skipped: "capture errored: headless timeout",
      failed: true,
      error: "headless timeout",
    });
  });
});

describe("writeEvidenceJson", () => {
  it("writes a stable 2-space manifest into the run dir", async () => {
    const runDir = tmp("r");
    const { run } = fakeRun({ git: { code: 0, stdout: "", stderr: "" } });
    const m = await collectEvidence({
      storyId: "FIX-9",
      projectPath: tmp("p"),
      runDir,
      now: () => NOW,
      run,
      ghProbe: () => Promise.resolve(false),
    });
    const p = writeEvidenceJson(m, runDir);
    const text = readFileSync(p, "utf8");
    expect(p.endsWith("evidence.json")).toBe(true);
    expect(JSON.parse(text)).toEqual(m);
    expect(text).toContain('  "story_id": "FIX-9"');
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("openEvidenceFrame", () => {
  it("creates the run frame plus evidence/ and screenshots/ directories", () => {
    const runDir = join(tmp("frame"), "US-EVID-001-run");
    const frame = openEvidenceFrame({ runDir });
    expect(frame.runDir).toBe(runDir);
    expect(frame.evidenceDir).toBe(join(runDir, "evidence"));
    expect(frame.screenshotsDir).toBe(join(runDir, "screenshots"));
    expect(statSync(runDir).isDirectory()).toBe(true);
    expect(statSync(frame.evidenceDir).isDirectory()).toBe(true);
    expect(statSync(frame.screenshotsDir).isDirectory()).toBe(true);
  });

  it("is idempotent and never clears an already-opened frame", () => {
    const runDir = join(tmp("frame-idem"), "cycle-1");
    const frame = openEvidenceFrame({ runDir });
    writeFileSync(join(frame.evidenceDir, "kept.txt"), "proof\n");
    const again = openEvidenceFrame({ runDir });
    expect(again).toEqual(frame);
    expect(readFileSync(join(frame.evidenceDir, "kept.txt"), "utf8")).toBe("proof\n");
  });
});
