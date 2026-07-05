/**
 * US-PHYSICAL-007 — `roll attest` rejects fullscreen-sized images for window
 * targets and records provenance metadata for every accepted physical screenshot.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { RollCaptureRequestV1, RollCaptureResponseV1 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V1 } from "@roll/spec";
import type { RollCaptureProviderPort, RollCaptureProviderResult } from "@roll/infra";
import { attestCommand } from "../src/commands/attest.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

const T0 = new Date("2026-07-05T15:00:00");
const quietRun = (): Promise<{ code: 0; stdout: ""; stderr: "" }> => Promise.resolve({ code: 0, stdout: "", stderr: "" });

function tmp(tag: string): string {
  const d = resolve(mkdtempSync(join(tmpdir(), `roll-007-${tag}-`)));
  dirs.push(d);
  return d;
}

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

function writeMinimalPng(path: string, width: number, height: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR", "ascii");
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrCrc = Buffer.alloc(4);
  writeFileSync(path, Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, ihdrCrc]));
}

function physicalSpec(id: string, extraFrontmatter: string[] = []): string {
  return [
    "---",
    `id: ${id}`,
    "physical_terminal:",
    "  app: Terminal.app",
    "  command: roll doctor --tools",
    "  evidence: screenshot",
    ...extraFrontmatter,
    "---",
    "",
    `# ${id} — physical screenshot privacy`,
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] [visual-evidence] real physical Terminal.app screenshot",
    "",
  ].join("\n");
}

function displaySpec(id: string, captureFullscreen: boolean): string {
  return [
    "---",
    `id: ${id}`,
    "evidence_profile: physical",
    captureFullscreen ? "capture_fullscreen: true" : "",
    "---",
    "",
    `# ${id} — display capture`,
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] [visual-evidence] fullscreen screenshot",
    "",
  ].join("\n");
}

function writePeerScore(wt: string, id: string, cycleId: string): void {
  const dir = join(wt, ".roll", "features", "capture-tool", id, "notes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `2026-07-05-roll-build-${id}-8.md`),
    [
      "---",
      "skill: roll-build",
      `story: ${id}`,
      "score: 8",
      "verdict: good",
      "ts: 2026-07-05T12:00:00Z",
      "scoring: pair",
      "scored-by: pi",
      `session-id: ${cycleId}:score:pi:a1:1700000000`,
      "---",
      "",
      "peer score fixture.",
    ].join("\n"),
  );
}

function acMap(id: string): string {
  return JSON.stringify([
    {
      ac: `${id}:AC1`,
      status: "pass",
      evidence: [{ kind: "screenshot", label: "physical screenshot", href: "screenshots/physical.png" }],
    },
  ]);
}

class FakeRollCaptureProvider implements RollCaptureProviderPort {
  private readonly responseByRequest: Map<string, RollCaptureResponseV1> = new Map();

  addResponse(requestId: string, response: RollCaptureResponseV1): void {
    this.responseByRequest.set(requestId, response);
  }

  async writeRequest(request: RollCaptureRequestV1): Promise<void> {
    const path = request.out.replace(/screenshots\/physical\.png$/, `inbox/request-${request.requestId}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(request, null, 2) + "\n");
  }

  async readResponse(request: RollCaptureRequestV1): Promise<RollCaptureResponseV1 | null> {
    return this.responseByRequest.get(request.requestId) ?? null;
  }

  async waitForResponse(request: RollCaptureRequestV1, _options: { timeoutMs: number }): Promise<RollCaptureProviderResult> {
    const response = this.responseByRequest.get(request.requestId);
    if (response === undefined) return { status: "timeout", reason: "no response staged" };
    if (response.status === "taken") {
      if (response.screenshotPath === undefined || response.screenshotPath === "") {
        return { status: "failed", reason: "taken response did not include screenshotPath", response };
      }
      return { status: "taken", path: response.screenshotPath, response };
    }
    if (response.status === "skipped") {
      return { status: "skipped", reason: response.reason ?? "skipped", response };
    }
    return { status: "failed", reason: response.reason ?? "failed", response };
  }
}

function runDirForCard(cardDir: string): string {
  for (const name of readdirSync(cardDir)) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(name) || /^\d{8}-\d{6}-\d+/.test(name)) {
      return join(cardDir, name);
    }
  }
  return "";
}

function physicalRequestId(storyId: string): string {
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const runId = `${T0.getFullYear()}-${p2(T0.getMonth() + 1)}-${p2(T0.getDate())}T${p2(T0.getHours())}-${p2(T0.getMinutes())}-${p2(T0.getSeconds())}`;
  return `${storyId}-${runId}-physical`.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
}

describe("US-PHYSICAL-007 attest physical screenshot privacy check", () => {
  it("rejects a window-targeted fullscreen image and records the rejection", async () => {
    const proj = tmp("privacy-reject");
    const id = "US-PHYS-007-REJECT";
    const cardDir = join(proj, ".roll", "features", "capture-tool", id);
    mkdirSync(cardDir, { recursive: true });
    writeFileSync(join(cardDir, "spec.md"), physicalSpec(id));
    writeFileSync(join(cardDir, "ac-map.json"), acMap(id));
    writePeerScore(proj, id, "c-007-reject");

    const screenshotPath = join(cardDir, "host.png");
    writeMinimalPng(screenshotPath, 1920, 1080);

    const provider = new FakeRollCaptureProvider();
    provider.addResponse(physicalRequestId(id), {
      protocol: ROLL_CAPTURE_PROTOCOL_V1,
      requestId: physicalRequestId(id),
      status: "taken",
      screenshotPath,
      responsePath: join(proj, "responses", `response-${id}-physical.json`),
      imageWidth: 1920,
      imageHeight: 1080,
      host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
      startedAt: "2026-07-05T15:00:01.000+08:00",
      finishedAt: "2026-07-05T15:00:02.000+08:00",
    });

    await silenced(() =>
      inDir(proj, () =>
        attestCommand([id], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          rollCapture: {
            provider,
            readiness: () => ({ status: "available", installed: { status: "installed" }, hostPermission: { status: "granted", detail: "" }, inbox: { status: "writable", path: "/tmp", detail: "" }, detailLines: [], repairCommands: [] }),
            root: proj,
          },
        }),
      ),
    );

    const runDir = runDirForCard(cardDir);
    expect(runDir).not.toBe("");
    expect(existsSync(join(runDir, "screenshots", "physical.png"))).toBe(false);
    const evidence = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as {
      captures?: Array<{ kind?: string; taken?: boolean; skipped?: string }>;
    };
    const capture = evidence.captures?.find((c) => c.kind === "physical_terminal");
    expect(capture).toBeDefined();
    expect(capture!.taken).toBe(false);
    expect(capture!.skipped).toContain("window capture rejected");

    const html = readFileSync(join(runDir, `${id}-report.html`), "utf8");
    expect(html).toContain("privacy-rejected");
    expect(html).toContain("window capture rejected");
  });

  it("accepts a window-targeted image smaller than the display and annotates provenance", async () => {
    const proj = tmp("privacy-accept");
    const id = "US-PHYS-007-ACCEPT";
    const cardDir = join(proj, ".roll", "features", "capture-tool", id);
    mkdirSync(cardDir, { recursive: true });
    writeFileSync(join(cardDir, "spec.md"), physicalSpec(id));
    writeFileSync(join(cardDir, "ac-map.json"), acMap(id));
    writePeerScore(proj, id, "c-007-accept");

    const screenshotPath = join(cardDir, "host.png");
    writeMinimalPng(screenshotPath, 1280, 800);

    const provider = new FakeRollCaptureProvider();
    provider.addResponse(physicalRequestId(id), {
      protocol: ROLL_CAPTURE_PROTOCOL_V1,
      requestId: physicalRequestId(id),
      status: "taken",
      screenshotPath,
      responsePath: join(proj, "responses", `response-${id}-physical.json`),
      imageWidth: 1280,
      imageHeight: 800,
      host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
      startedAt: "2026-07-05T15:00:01.000+08:00",
      finishedAt: "2026-07-05T15:00:02.000+08:00",
    });

    await silenced(() =>
      inDir(proj, () =>
        attestCommand([id], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          rollCapture: {
            provider,
            readiness: () => ({ status: "available", installed: { status: "installed" }, hostPermission: { status: "granted", detail: "" }, inbox: { status: "writable", path: "/tmp", detail: "" }, detailLines: [], repairCommands: [] }),
            root: proj,
          },
        }),
      ),
    );

    const runDir = runDirForCard(cardDir);
    expect(existsSync(join(runDir, "screenshots", "physical.png"))).toBe(true);
    const evidence = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as {
      captures?: Array<{ kind?: string; taken?: boolean }>;
    };
    const capture = evidence.captures?.find((c) => c.kind === "physical_terminal");
    expect(capture?.taken).toBe(true);

    const html = readFileSync(join(runDir, `${id}-report.html`), "utf8");
    expect(html).toContain("Target");
    expect(html).toContain("目标");
    expect(html).toContain("Terminal.app");
    expect(html).toContain("Requested by");
    expect(html).toContain("请求方");
  });

  it("accepts an explicitly declared fullscreen display capture", async () => {
    const proj = tmp("display-declared");
    const id = "US-PHYS-007-DISPLAY-OK";
    const cardDir = join(proj, ".roll", "features", "capture-tool", id);
    mkdirSync(cardDir, { recursive: true });
    writeFileSync(join(cardDir, "spec.md"), displaySpec(id, true));
    writeFileSync(join(cardDir, "ac-map.json"), acMap(id));
    writePeerScore(proj, id, "c-007-display-ok");

    const screenshotPath = join(cardDir, "host.png");
    writeMinimalPng(screenshotPath, 1920, 1080);

    const provider = new FakeRollCaptureProvider();
    provider.addResponse(physicalRequestId(id), {
      protocol: ROLL_CAPTURE_PROTOCOL_V1,
      requestId: physicalRequestId(id),
      status: "taken",
      screenshotPath,
      responsePath: join(proj, "responses", `response-${id}-physical.json`),
      imageWidth: 1920,
      imageHeight: 1080,
      host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
      startedAt: "2026-07-05T15:00:01.000+08:00",
      finishedAt: "2026-07-05T15:00:02.000+08:00",
    });

    await silenced(() =>
      inDir(proj, () =>
        attestCommand([id], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          rollCapture: {
            provider,
            readiness: () => ({ status: "available", installed: { status: "installed" }, hostPermission: { status: "granted", detail: "" }, inbox: { status: "writable", path: "/tmp", detail: "" }, detailLines: [], repairCommands: [] }),
            root: proj,
          },
        }),
      ),
    );

    const runDir = runDirForCard(cardDir);
    expect(existsSync(join(runDir, "screenshots", "physical.png"))).toBe(true);
    const evidence = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as {
      captures?: Array<{ kind?: string; taken?: boolean }>;
    };
    const capture = evidence.captures?.find((c) => c.kind === "display");
    expect(capture?.taken).toBe(true);

    const html = readFileSync(join(runDir, `${id}-report.html`), "utf8");
    expect(html).toContain("Declared fullscreen");
    expect(html).toContain("显式声明全屏");
  });

  it("rejects undeclared fullscreen capture regardless of how it arrived", async () => {
    const proj = tmp("display-no-declare");
    const id = "US-PHYS-007-DISPLAY";
    const cardDir = join(proj, ".roll", "features", "capture-tool", id);
    mkdirSync(cardDir, { recursive: true });
    // capture_fullscreen is NOT declared, but the host returns a fullscreen image.
    writeFileSync(join(cardDir, "spec.md"), displaySpec(id, false));
    writeFileSync(join(cardDir, "ac-map.json"), acMap(id));
    writePeerScore(proj, id, "c-007-display");

    const screenshotPath = join(cardDir, "host.png");
    writeMinimalPng(screenshotPath, 1920, 1080);

    const provider = new FakeRollCaptureProvider();
    provider.addResponse(physicalRequestId(id), {
      protocol: ROLL_CAPTURE_PROTOCOL_V1,
      requestId: physicalRequestId(id),
      status: "taken",
      screenshotPath,
      responsePath: join(proj, "responses", `response-${id}-physical.json`),
      imageWidth: 1920,
      imageHeight: 1080,
      host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
      startedAt: "2026-07-05T15:00:01.000+08:00",
      finishedAt: "2026-07-05T15:00:02.000+08:00",
    });

    await silenced(() =>
      inDir(proj, () =>
        attestCommand([id], {
          now: () => T0,
          run: quietRun,
          ghProbe: () => Promise.resolve(false),
          rollCapture: {
            provider,
            readiness: () => ({ status: "available", installed: { status: "installed" }, hostPermission: { status: "granted", detail: "" }, inbox: { status: "writable", path: "/tmp", detail: "" }, detailLines: [], repairCommands: [] }),
            root: proj,
          },
        }),
      ),
    );

    const runDir = runDirForCard(cardDir);
    const evidence = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as {
      captures?: Array<{ kind?: string; taken?: boolean; skipped?: string }>;
    };
    const capture = evidence.captures?.find((c) => c.kind !== undefined && c.taken === false);
    expect(capture?.taken).toBe(false);
    expect(capture?.skipped).toMatch(/fullscreen size|window capture rejected/);
  });
});
