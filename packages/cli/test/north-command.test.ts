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
});
