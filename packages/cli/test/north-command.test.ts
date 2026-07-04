import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";

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

function withEnvCwd<T>(env: Record<string, string>, cwd: string, fn: () => Promise<T>): Promise<T> {
  const savedEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    savedEnv.set(key, process.env[key]);
    process.env[key] = value;
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

describe("roll north --json", () => {
  it("is hidden from usage but registered as a read-only JSON command", async () => {
    registerAll();
    const project = mkdtempSync(join(tmpdir(), "roll-north-empty-"));
    const result = await withEnvCwd({ ROLL_MAIN_PROJECT: project, ROLL_PROJECT_RUNTIME_DIR: join(project, ".roll", "loop") }, project, () =>
      captureStdout(() => dispatch(["north", "--json"], async () => ({ ok: true }))),
    );

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as { metrics: Record<string, { current: unknown; reason?: string }> };
    expect(Object.keys(json.metrics)).toEqual(["autonomy", "deliveryRate", "fixTax", "attributionErrors"]);
    expect(json.metrics["autonomy"]?.current).toBeNull();
    expect(json.metrics["autonomy"]?.reason).toBe("no_history");
  });

  it("reads runs/events/deliveries/backlog/features and emits north-star metrics", async () => {
    registerAll();
    const project = mkdtempSync(join(tmpdir(), "roll-north-project-"));
    const loop = join(project, ".roll", "loop");
    const feature = join(project, ".roll", "features", "loop-harness", "FIX-1");
    mkdirSync(loop, { recursive: true });
    mkdirSync(feature, { recursive: true });
    writeFileSync(
      join(loop, "runs.jsonl"),
      [
        { run_id: "c1", cycle_id: "c1", status: "merged", outcome: "delivered", ts: "2026-07-03T01:00:00Z", story_id: "US-1", built: ["US-1"] },
        { run_id: "c2", cycle_id: "c2", status: "failed", outcome: "failed", ts: "2026-07-03T02:00:00Z", story_id: "FIX-1", failure_class: "env", root_cause_key: "r1" },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    writeFileSync(
      join(loop, "events.ndjson"),
      [
        { type: "policy:safety_pause", ts: Date.parse("2026-07-03T00:00:00Z") },
        { type: "goal:card_skipped", ts: Date.parse("2026-07-03T03:00:00Z"), storyId: "US-2", failure_class: "env" },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    writeFileSync(join(loop, "deliveries.jsonl"), `${JSON.stringify({ storyId: "US-1", lifecycleState: "done", recordedAt: Date.parse("2026-07-03T01:30:00Z") })}\n`);
    writeFileSync(join(project, ".roll", "backlog.md"), "| ID | Title | Status |\n|---|---|---|\n| [US-1](x) | done | ✅ Done |\n");
    writeFileSync(
      join(feature, "spec.md"),
      [
        "---",
        "id: FIX-1",
        "type: fix",
        "epic: loop-harness",
        "created: 2026-07-03",
        "---",
        "# FIX-1",
        "",
      ].join("\n"),
    );

    const result = await withEnvCwd({ ROLL_MAIN_PROJECT: project, ROLL_PROJECT_RUNTIME_DIR: loop, ROLL_NORTH_NOW: "2026-07-03T16:00:00Z" }, project, () =>
      captureStdout(() => dispatch(["north", "--json"], async () => ({ ok: true }))),
    );

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as {
      metrics: {
        deliveryRate: { current: number };
        fixTax: { context: { newFixCards: number } };
        attributionErrors: { current: number; context: { unknownFailureClass: number } };
      };
    };
    expect(json.metrics.deliveryRate.current).toBe(0.5);
    expect(json.metrics.fixTax.context.newFixCards).toBe(1);
    expect(json.metrics.attributionErrors.current).toBe(1);
    expect(json.metrics.attributionErrors.context.unknownFailureClass).toBe(0);
  });

  it("renders a deterministic no-data panel when loop data is damaged", async () => {
    registerAll();
    const project = mkdtempSync(join(tmpdir(), "roll-north-damaged-"));
    const rollMeta = join(project, ".roll");
    const damagedLoop = join(rollMeta, "loop");
    mkdirSync(rollMeta, { recursive: true });
    writeFileSync(damagedLoop, "not a directory\n");

    const result = await withEnvCwd(
      {
        ROLL_MAIN_PROJECT: project,
        ROLL_PROJECT_RUNTIME_DIR: damagedLoop,
        ROLL_NORTH_NOW: "2026-07-03T16:00:00Z",
        NO_COLOR: "1",
        ROLL_LANG: "en",
      },
      project,
      () => captureStdout(() => dispatch(["north"], async () => ({ ok: true }))),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("North Star · 14d · 2026-06-21..2026-07-04");
    expect(result.stdout).toContain("autonomy             no data · no history");
    expect(result.stdout).toContain("fix tax              no data · no history");
  });

  it("includes a recent supervisor journal summary line when journal events exist", async () => {
    registerAll();
    const project = mkdtempSync(join(tmpdir(), "roll-north-journal-"));
    const loop = join(project, ".roll", "loop");
    mkdirSync(loop, { recursive: true });
    writeFileSync(
      join(loop, "events.ndjson"),
      [
        { type: "supervisor:journal", ts: Date.parse("2026-07-04T12:00:00Z"), actor: "owner", action: "rescue", storyId: "US-OBS-048", note: "rerouted" },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    );

    const result = await withEnvCwd(
      { ROLL_MAIN_PROJECT: project, ROLL_PROJECT_RUNTIME_DIR: loop, ROLL_NORTH_NOW: "2026-07-04T16:00:00Z", NO_COLOR: "1", ROLL_LANG: "en" },
      project,
      () => captureStdout(() => dispatch(["north"], async () => ({ ok: true }))),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("journal: 1 entries");
    expect(result.stdout).toContain("latest: rescue by owner");
  });

  it("discovers all rotated event segments and falls back to git-created FIX dates in one meta scan", async () => {
    registerAll();
    const project = mkdtempSync(join(tmpdir(), "roll-north-rotated-"));
    const rollMeta = join(project, ".roll");
    const loop = join(rollMeta, "loop");
    const fixOne = join(rollMeta, "features", "loop-harness", "FIX-1");
    const fixTwo = join(rollMeta, "features", "loop-harness", "FIX-2");
    mkdirSync(loop, { recursive: true });
    mkdirSync(fixOne, { recursive: true });
    mkdirSync(fixTwo, { recursive: true });
    writeFileSync(join(loop, "runs.jsonl"), `${JSON.stringify({ run_id: "c1", status: "merged", outcome: "delivered", ts: 1783040400, story_id: "US-1" })}\n`);
    writeFileSync(join(loop, "events.ndjson.7"), `${JSON.stringify({ type: "policy:safety_pause", ts: 1783044000000 })}\n`);
    writeFileSync(join(loop, "events.ndjson.12"), `${JSON.stringify({ type: "loop:resumed", ts: 1783047600000 })}\n`);
    writeFileSync(join(rollMeta, "backlog.md"), "| ID | Title | Status |\n|---|---|---|\n| [US-1](x) | active | 📋 Todo |\n");
    writeFileSync(join(fixOne, "spec.md"), "---\nid: FIX-1\ntype: fix\nepic: loop-harness\n---\n# FIX-1\n");
    writeFileSync(join(fixTwo, "spec.md"), "---\nid: FIX-2\ntype: fix\nepic: loop-harness\n---\n# FIX-2\n");
    execFileSync("git", ["-C", rollMeta, "init"], { stdio: "ignore" });
    execFileSync("git", ["-C", rollMeta, "config", "user.email", "roll@example.test"], { stdio: "ignore" });
    execFileSync("git", ["-C", rollMeta, "config", "user.name", "Roll Test"], { stdio: "ignore" });
    execFileSync("git", ["-C", rollMeta, "add", "features/loop-harness/FIX-1/spec.md", "features/loop-harness/FIX-2/spec.md"], { stdio: "ignore" });
    execFileSync("git", ["-C", rollMeta, "commit", "-m", "add fix cards", "--date", "2026-07-03T00:00:00Z"], {
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-07-03T00:00:00Z", GIT_COMMITTER_DATE: "2026-07-03T00:00:00Z" },
      stdio: "ignore",
    });

    const result = await withEnvCwd({ ROLL_MAIN_PROJECT: project, ROLL_PROJECT_RUNTIME_DIR: loop, ROLL_NORTH_NOW: "2026-07-03T16:00:00Z" }, project, () =>
      captureStdout(() => dispatch(["north", "--json"], async () => ({ ok: true }))),
    );

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as {
      metrics: {
        autonomy: { context: { disruptions: number; segmentBoundaries: number } };
        fixTax: { context: { newFixCards: number } };
      };
    };
    expect(json.metrics.autonomy.context.disruptions).toBe(1);
    expect(json.metrics.autonomy.context.segmentBoundaries).toBe(2);
    expect(json.metrics.fixTax.context.newFixCards).toBe(2);
  });
});
