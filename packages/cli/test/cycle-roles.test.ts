/**
 * US-OBS-033 — roll cycle show roles view: tests for --roles flag on the
 * existing roll cycle command. Verifies terminal and JSON output shape,
 * missing artifact rebuild, and unavailable cycle handling.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cycleCommand } from "../src/commands/cycle.js";

const CYCLE_ID = "20260629-112437-39253";

const fixtureEvents: unknown[] = [
  { type: "cycle:start", cycleId: CYCLE_ID, storyId: "US-TASK-001", agent: "pi", model: "deepseek-v4-pro", ts: 1000 },
  { type: "pair:selected", cycleId: CYCLE_ID, workingAgent: "pi", peer: "reasonix", stage: "review", ts: 1100 },
  { type: "pair:selected", cycleId: CYCLE_ID, workingAgent: "pi", peer: "kimi", stage: "review", ts: 1105 },
  { type: "pair:selected", cycleId: CYCLE_ID, workingAgent: "pi", peer: "codex", stage: "review", ts: 1110 },
  { type: "pair:verdict", cycleId: CYCLE_ID, peer: "reasonix", verdict: "refine", findings: 0, ts: 1200 },
  { type: "pair:consult", cycleId: CYCLE_ID, peer: "kimi", durationMs: 45000, outcome: "reviewed", ts: 1210 },
  { type: "pair:consult", cycleId: CYCLE_ID, peer: "codex", durationMs: 52000, outcome: "reviewed", ts: 1220 },
  { type: "pair:selected", cycleId: CYCLE_ID, workingAgent: "pi", peer: "reasonix", stage: "score", ts: 1300 },
  { type: "pair:score", cycleId: CYCLE_ID, peer: "reasonix", score: 10, verdict: "good", cost: 0.05, stage: "score", ts: 1400 },
  { type: "pair:score-failure", cycleId: CYCLE_ID, peer: "agy", cause: "unparseable", detail: "control characters before SCORE", stage: "score", ts: 1410 },
  { type: "attest:gate", cycleId: CYCLE_ID, verdict: "produced", reasons: ["review-score good 10/10 present"], ts: 1500 },
  { type: "peer:gate", cycleId: CYCLE_ID, verdict: "consulted", reasons: ["peer review completed"], ts: 1510 },
  { type: "cycle:end", cycleId: CYCLE_ID, outcome: "delivered", cost: { cycleId: CYCLE_ID, agent: "pi", model: "deepseek-v4-pro", tokensIn: 10000, tokensOut: 2000, estimatedCost: 1.5, revertCount: 0, effectiveCost: 1.5 }, ts: 1600 },
];

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function tempDir(tag: string): { root: string; eventsPath: string; peerDir: string; cycleLogDir: string } {
  const root = mkdtempSync(join(tmpdir(), `roll-cycle-roles-${tag}-`));
  dirs.push(root);
  const loopDir = join(root, "loop");
  const peerDir = join(loopDir, "peer");
  const cycleLogDir = join(loopDir, "cycle-logs");
  const eventsPath = join(loopDir, "events.ndjson");
  mkdirSync(peerDir, { recursive: true });
  mkdirSync(cycleLogDir, { recursive: true });
  return { root, eventsPath, peerDir, cycleLogDir };
}

function writeEvents(eventsPath: string): void {
  writeFileSync(eventsPath, fixtureEvents.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

function runCycleRoles(handle: string, env: Record<string, string>): { stdout: string; stderr: string; code: number } {
  const origEnv = { ...process.env };
  const origCwd = process.cwd;
  const origWrite = process.stdout.write;
  const origErrWrite = process.stderr.write;
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  // Swap process.env
  const restored: Array<() => void> = [];
  for (const [k, v] of Object.entries(env)) {
    const prev = process.env[k];
    process.env[k] = v;
    restored.push(() => { process.env[k] = prev; });
  }

  try {
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutParts.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrParts.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    const code = cycleCommand([handle, "--roles"]);
    return { stdout: stdoutParts.join(""), stderr: stderrParts.join(""), code: code as number };
  } finally {
    process.stdout.write = origWrite;
    process.stderr.write = origErrWrite;
    for (const r of restored) r();
  }
}

function runCycleRolesJson(handle: string, env: Record<string, string>): { stdout: string; stderr: string; code: number } {
  const origEnv = { ...process.env };
  const origWrite = process.stdout.write;
  const origErrWrite = process.stderr.write;
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  const restored: Array<() => void> = [];
  for (const [k, v] of Object.entries(env)) {
    const prev = process.env[k];
    process.env[k] = v;
    restored.push(() => { process.env[k] = prev; });
  }

  try {
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutParts.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrParts.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    const code = cycleCommand([handle, "--roles", "--json"]);
    return { stdout: stdoutParts.join(""), stderr: stderrParts.join(""), code: code as number };
  } finally {
    process.stdout.write = origWrite;
    process.stderr.write = origErrWrite;
    for (const r of restored) r();
  }
}

describe("cycle roles view", () => {
  it("renders human-readable roles from events.ndjson when no summary artifact exists", () => {
    const { root, eventsPath, peerDir, cycleLogDir } = tempDir("rebuild");
    writeEvents(eventsPath);

    const { stdout, stderr, code } = runCycleRoles(CYCLE_ID, {
      ROLL_PROJECT_RUNTIME_DIR: join(root, "loop"),
    });

    expect(code).toBe(0);
    expect(stderr).toBe("");

    // Builder section
    expect(stdout).toContain("## Builder");
    expect(stdout).toContain("pi / deepseek-v4-pro");

    // Peer Review section
    expect(stdout).toContain("## Peer Review");
    expect(stdout).toContain("reasonix: accepted verdict=refine findings=0");
    expect(stdout).toContain("kimi: returned");
    expect(stdout).toContain("codex: returned");

    // Evaluator section
    expect(stdout).toContain("## Evaluator / Score");
    expect(stdout).toContain("reasonix: accepted score=10 verdict=good");
    expect(stdout).toContain("agy: failed unparseable");

    // Gates section
    expect(stdout).toContain("## Gates");
    expect(stdout).toContain("attest: produced");
    expect(stdout).toContain("peer: consulted");
    expect(stdout).toContain("delivery: delivered");
  });

  it("renders human-readable roles from cached summary.json when artifact exists", () => {
    const { root, eventsPath, peerDir, cycleLogDir } = tempDir("cached");

    // Write events + pre-generate summary artifact
    writeEvents(eventsPath);
    const summaryDir = join(cycleLogDir, CYCLE_ID);
    mkdirSync(summaryDir, { recursive: true });

    // Build a summary via the core function and cache it
    const { buildCycleRoleSummary } = require("@roll/core") as { buildCycleRoleSummary: (input: unknown) => unknown };
    const summary = buildCycleRoleSummary({
      cycleId: CYCLE_ID,
      events: fixtureEvents,
      eventsPath,
      peerDir,
      cycleLogDir,
    });
    writeFileSync(join(summaryDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

    const { stdout, stderr, code } = runCycleRoles(CYCLE_ID, {
      ROLL_PROJECT_RUNTIME_DIR: join(root, "loop"),
    });

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("## Builder");
    expect(stdout).toContain("pi / deepseek-v4-pro");
    expect(stdout).toContain("## Peer Review");
    expect(stdout).toContain("## Evaluator / Score");
    expect(stdout).toContain("## Gates");
  });

  it("returns JSON when --json flag is combined with --roles", () => {
    const { root, eventsPath, peerDir, cycleLogDir } = tempDir("json");
    writeEvents(eventsPath);

    const { stdout, stderr, code } = runCycleRolesJson(CYCLE_ID, {
      ROLL_PROJECT_RUNTIME_DIR: join(root, "loop"),
    });

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.schema).toBe("cycle-role-summary.v1");
    expect(parsed.cycleId).toBe(CYCLE_ID);
    expect(parsed.storyId).toBe("US-TASK-001");
    expect(parsed.executionProfile).toBe("standard");
    expect(Array.isArray(parsed.roles)).toBe(true);
    expect(typeof parsed.generatedAt).toBe("string");

    // Builder role present
    const builder = (parsed.roles as Array<Record<string, unknown>>).find((r) => r.role === "builder");
    expect(builder).toBeDefined();
    expect(builder!.agent).toBe("pi");
    expect(builder!.model).toBe("deepseek-v4-pro");
  });

  it("prints unavailable message when no events and no summary exist for the cycle", () => {
    const { root, eventsPath, peerDir, cycleLogDir } = tempDir("unavailable");
    // Write no events at all

    const { stdout, stderr, code } = runCycleRoles(CYCLE_ID, {
      ROLL_PROJECT_RUNTIME_DIR: join(root, "loop"),
    });

    expect(code).toBe(1);
    expect(stderr).toContain("not found");
    expect(stdout).toBe("");
  });

  it("prints unavailable message when cycle has no matching events", () => {
    const { root, eventsPath, peerDir, cycleLogDir } = tempDir("noevents");
    // Write an empty events.ndjson
    writeFileSync(eventsPath, "\n", "utf8");

    const { stdout, stderr, code } = runCycleRoles(CYCLE_ID, {
      ROLL_PROJECT_RUNTIME_DIR: join(root, "loop"),
    });

    expect(code).toBe(1);
    expect(stderr).toContain("no events available");
    expect(stdout).toBe("");
  });
});
