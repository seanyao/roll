/**
 * US-EVID-026 — the exemption-rate smell signal must actually surface in the
 * live `roll dashboard` output (AC2). Fixture-mode byte-stability is guarded by
 * dashboard.difftest.test.ts (the frozen snapshots must not move); here we drive
 * the LIVE, non-fixture path against an injected corpus and assert the line is
 * present. The corpus root is resolved via ROLL_MAIN_PROJECT so the test is
 * deterministic and never reads the real repo's .roll/features.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dashboardCommand } from "../src/commands/dashboard.js";
import { renderState } from "../src/render.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

/** Minimal host-neutralizing sandbox (mirrors dashboard.difftest.test.ts). */
function sandboxEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const home = mkdtempSync(join(tmpdir(), "roll-exempt-home-"));
  const rt = mkdtempSync(join(tmpdir(), "roll-exempt-rt-"));
  const shared = mkdtempSync(join(tmpdir(), "roll-exempt-shared-"));
  const notes = mkdtempSync(join(tmpdir(), "roll-exempt-notes-"));
  const bin = mkdtempSync(join(tmpdir(), "roll-exempt-bin-"));
  dirs.push(home, rt, shared, notes, bin);
  writeFileSync(join(bin, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return {
    HOME: home,
    ROLL_PROJECT_RUNTIME_DIR: rt,
    ROLL_SHARED_ROOT: shared,
    ROLL_NOTES_DIR: notes,
    ROLL_FEATURES_DIR: join(notes, "features-empty"),
    ROLL_MAIN_SLUG: "test-exempt",
    ROLL_RENDER_NOW: "2026-06-07T03:18:30Z",
    PATH: `${bin}:${process.env["PATH"] ?? ""}`,
    ...extra,
  };
}

/** A project dir whose .roll/features corpus has `exempt` exempt cards out of `total`. */
function corpusProject(total: number, exempt: number): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-exempt-proj-"));
  dirs.push(proj);
  for (let i = 0; i < total; i++) {
    const dir = join(proj, ".roll", "features", "epicA", `US-${i}`);
    mkdirSync(dir, { recursive: true });
    const line = i < exempt ? "screenshot_exempt: backend; tests are evidence\n" : "";
    writeFileSync(join(dir, "spec.md"), `---\nid: US-${i}\ntitle: t\n${line}---\n\n# US-${i}\n`, "utf8");
  }
  return proj;
}

function tsRun(env: Record<string, string | undefined>, argv: string[], cwd: string): string {
  const saveEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    dashboardCommand(argv);
  } finally {
    process.stdout.write = realWrite;
    renderState.useColor = true;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return chunks.join("");
}

describe("US-EVID-026 — live dashboard surfaces the exemption signal", () => {
  it("prints the overall screenshot_exempt rate from the injected corpus", () => {
    const proj = corpusProject(4, 1); // 25% exempt
    const env = sandboxEnv({ ROLL_MAIN_PROJECT: proj });
    const out = tsRun(env, ["--no-color"], REPO);
    expect(out).toContain("screenshot_exempt: 25% (1/4)");
  });

  it("does not print the signal when the corpus is empty (nothing to surface)", () => {
    const proj = corpusProject(0, 0);
    const env = sandboxEnv({ ROLL_MAIN_PROJECT: proj });
    const out = tsRun(env, ["--no-color"], REPO);
    expect(out).not.toContain("screenshot_exempt:");
  });
});
