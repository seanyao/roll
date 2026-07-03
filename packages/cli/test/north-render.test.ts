import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNorthStarReport } from "@roll/core";
import type { NorthStarReport } from "@roll/core";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";
import { renderNorthPanel } from "../src/commands/north.js";
import { renderState, sparkline, stripAnsi, strw } from "../src/render.js";

function captureStdout(fn: () => Promise<{ status: number }>): Promise<{ status: number; stdout: string }> {
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only override
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  return fn().then(
    (result) => {
      process.stdout.write = realWrite;
      return { status: result.status, stdout: chunks.join("") };
    },
    (error: unknown) => {
      process.stdout.write = realWrite;
      throw error;
    },
  );
}

function withEnvCwd<T>(env: Record<string, string | undefined>, cwd: string, fn: () => Promise<T>): Promise<T> {
  const savedEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    savedEnv.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const savedCwd = process.cwd();
  process.chdir(cwd);
  return fn().finally(() => {
    process.chdir(savedCwd);
    for (const [key, value] of savedEnv.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function reportWithDaily(values: number[]): NorthStarReport {
  const daily = values.map((value, index) => ({ day: `2026-06-${String(20 + index).padStart(2, "0")}`, value }));
  return {
    schema: "roll.north.v1",
    generatedAt: "2026-07-03T16:00:00.000Z",
    windowDays: 14,
    window: { startDay: "2026-06-20", endDay: "2026-07-04" },
    metrics: {
      autonomy: {
        current: 80,
        target: { op: ">=", value: 72, unit: "hours" },
        daily,
        trend: "up",
        met: true,
        context: { bestHours: 80, sinceMs: 0, disruptions: 0, segmentBoundaries: 0, ineffectiveDays: [], backlogEmptyExemptDays: [] },
      },
      deliveryRate: {
        current: 0.5,
        target: { op: ">=", value: 0.6, unit: "ratio" },
        daily,
        trend: "flat",
        met: false,
        context: { nonIdleCycles: 2, deliveredCycles: 1, skipRate: 0, blockedRate: 0, reopenCount: 0, cardAgeDays: { min: null, p50: null, max: null }, cardTypes: {} },
      },
      fixTax: {
        current: 1.1,
        target: { op: "<", value: 1, unit: "ratio" },
        daily,
        trend: "down",
        met: false,
        context: { newFixCards: 1, productDeliveries: 1, refactorDeliveries: 0, byClass: { harness: 1, product: 0, docsTest: 0 }, duplicateRootCauseCount: 0, repeatedRootCauses: [] },
      },
      attributionErrors: {
        current: 0,
        target: { op: "=", value: 0, unit: "count" },
        daily,
        trend: "flat",
        met: true,
        context: { failedCycles: 0, unknownFailureClass: 0, envHarnessCardLedgerSkips: 0 },
      },
    },
  };
}

function seedProject(project: string, extraRun: boolean): string {
  const loop = join(project, ".roll", "loop");
  const featureUs = join(project, ".roll", "features", "loop-observability", "US-1");
  const featureFix = join(project, ".roll", "features", "loop-harness", "FIX-1");
  mkdirSync(loop, { recursive: true });
  mkdirSync(featureUs, { recursive: true });
  mkdirSync(featureFix, { recursive: true });
  const runs = [
    { run_id: "c1", status: "merged", outcome: "delivered", ts: "2026-07-02T01:00:00Z", story_id: "US-1" },
    { run_id: "c2", status: "failed", outcome: "failed", ts: "2026-07-02T02:00:00Z", story_id: "FIX-1", failure_class: "env", root_cause_key: "r1" },
    { run_id: "c3", status: "failed", outcome: "failed", ts: "2026-07-03T03:00:00Z", story_id: "US-2" },
    ...(extraRun ? [{ run_id: "c4", status: "merged", outcome: "delivered", ts: "2026-07-03T04:00:00Z", story_id: "US-2" }] : []),
  ];
  writeFileSync(join(loop, "runs.jsonl"), runs.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(join(loop, "events.ndjson"), `${JSON.stringify({ type: "goal:card_skipped", ts: "2026-07-03T05:00:00Z", failureClass: "env" })}\n`);
  writeFileSync(join(loop, "deliveries.jsonl"), `${JSON.stringify({ storyId: "US-1", lifecycleState: "done", recordedAt: Date.parse("2026-07-02T01:30:00Z") })}\n`);
  writeFileSync(join(project, ".roll", "backlog.md"), "| ID | Title | Status |\n|---|---|---|\n| [US-1](x) | done | ✅ Done |\n");
  writeFileSync(join(featureUs, "spec.md"), "---\nid: US-1\ntype: us\nepic: loop-observability\ncreated: 2026-07-01\n---\n# US-1\n");
  writeFileSync(join(featureFix, "spec.md"), "---\nid: FIX-1\ntype: fix\nepic: loop-harness\ncreated: 2026-07-02\n---\n# FIX-1\n");
  return loop;
}

describe("north-star terminal rendering", () => {
  it("renders sparkline buckets without color or TTY dependence", () => {
    expect(sparkline([])).toBe("");
    expect(sparkline([null, null])).toBe("··");
    expect(sparkline([5])).toBe("▁");
    expect(sparkline([0, 1, 2, 3, 4, 5, 6, 7])).toBe("▁▂▃▄▅▆▇█");
    expect(sparkline([0, null, 7])).toBe("▁·█");
  });

  it("renders EN and ZH panels with one metric per line and 80-column safety", () => {
    const en = stripAnsi(renderNorthPanel(reportWithDaily([0, 1, 2, 3, 4, 5, 6, 7]), "en", 80));
    const zh = stripAnsi(renderNorthPanel(reportWithDaily([0, 1, 2, 3, 4, 5, 6, 7]), "zh", 80));
    expect(en).toMatchSnapshot();
    expect(zh).toMatchSnapshot();
    for (const line of en.split("\n")) expect(strw(line)).toBeLessThanOrEqual(80);
    for (const line of zh.split("\n")) expect(strw(line)).toBeLessThanOrEqual(80);
  });

  it("renders a NO_COLOR panel snapshot with plain text status symbols", () => {
    const previous = renderState.useColor;
    renderState.useColor = false;
    try {
      expect(renderNorthPanel(reportWithDaily([0, 1, 2, 3, 4, 5, 6, 7]), "en", 80)).toMatchSnapshot();
    } finally {
      renderState.useColor = previous;
    }
  });

  it("renders null metrics as no data with a reason and no fake trend", () => {
    const report = buildNorthStarReport({ nowMs: Date.parse("2026-07-03T16:00:00Z"), days: [], runs: [], events: [], cards: [], backlog: [], deliveries: [] });
    const out = stripAnsi(renderNorthPanel(report, "en", 80));
    expect(out).toMatchSnapshot();
    expect(out).not.toContain("0%");
    expect(out).not.toContain("[▁");
  });

  it("roll north renders human output and updates after new event data", async () => {
    registerAll();
    const project = mkdtempSync(join(tmpdir(), "roll-north-render-"));
    const loop = seedProject(project, false);
    const env = { ROLL_MAIN_PROJECT: project, ROLL_PROJECT_RUNTIME_DIR: loop, ROLL_NORTH_NOW: "2026-07-03T16:00:00Z", NO_COLOR: "1", ROLL_LANG: "en" };
    const before = await withEnvCwd(env, project, () => captureStdout(() => dispatch(["north"], async () => ({ ok: true }))));
    seedProject(project, true);
    const after = await withEnvCwd(env, project, () => captureStdout(() => dispatch(["north"], async () => ({ ok: true }))));
    expect(before.status).toBe(0);
    expect(after.status).toBe(0);
    expect(before.stdout).toContain("North Star");
    expect(before.stdout).toContain("delivery rate");
    expect(after.stdout).not.toBe(before.stdout);
  });
});
