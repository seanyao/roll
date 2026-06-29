import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCycleRoleSummaryBestEffort } from "../src/runner/cycle-role-artifact-writer.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-cycle-role-writer-"));
  dirs.push(dir);
  return dir;
}

describe("cycle role artifact writer", () => {
  it("writes stable summary artifacts from events.ndjson", () => {
    const cycleId = "20260630-001207-27520";
    const root = tempDir();
    const loopDir = join(root, ".roll", "loop");
    const cycleLogDir = join(loopDir, "cycle-logs");
    const peerDir = join(loopDir, "peer");
    const eventsPath = join(loopDir, "events.ndjson");
    mkdirSync(peerDir, { recursive: true });
    writeFileSync(join(peerDir, `cycle-${cycleId}.pair.json`), "{}\n", "utf8");
    writeFileSync(join(peerDir, `cycle-${cycleId}.score.pair.json`), "{}\n", "utf8");
    writeFileSync(
      eventsPath,
      [
        { type: "cycle:start", cycleId, storyId: "US-OBS-032", agent: "reasonix", model: "deepseek-flash", ts: 100 },
        { type: "pair:selected", cycleId, workingAgent: "reasonix", peer: "codex", stage: "code", ts: 200 },
        { type: "pair:verdict", cycleId, peer: "codex", verdict: "refine", findings: 1, cost: 0, stage: "code", ts: 300 },
        { type: "peer:gate", cycleId, verdict: "consulted", reasons: ["code peer returned"], ts: 350 },
        { type: "pair:selected", cycleId, workingAgent: "reasonix", peer: "pi", stage: "score", ts: 360 },
        { type: "pair:score-failure", cycleId, peer: "pi", cause: "unparseable", detail: "missing verdict line", stage: "score", ts: 370 },
        { type: "cycle:end", cycleId, outcome: "failed", cost: { cycleId, agent: "reasonix", model: "deepseek-flash", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 400 },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );

    writeCycleRoleSummaryBestEffort(cycleId, eventsPath, cycleLogDir);

    const outDir = join(cycleLogDir, cycleId);
    const jsonPath = join(outDir, "summary.json");
    const mdPath = join(outDir, "summary.md");
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const summary = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      generatedAt: string;
      sources: string[];
      roles: Array<{ role: string; agent: string | null; state: string; artifactPath?: string; cause?: string }>;
    };
    expect(summary.generatedAt).toBe("1970-01-01T00:00:00.400Z");
    expect(summary.sources).toContain(eventsPath);
    expect(summary.sources).toContain(join(peerDir, `cycle-${cycleId}.pair.json`));
    expect(summary.sources).toContain(join(peerDir, `cycle-${cycleId}.score.pair.json`));
    expect(summary.roles).toContainEqual(expect.objectContaining({
      role: "peer_reviewer",
      agent: "codex",
      state: "accepted",
      artifactPath: join(peerDir, `cycle-${cycleId}.pair.json`),
    }));
    expect(summary.roles).toContainEqual(expect.objectContaining({
      role: "evaluator",
      agent: "pi",
      state: "failed",
      cause: "unparseable",
      artifactPath: join(peerDir, `cycle-${cycleId}.score.pair.json`),
    }));

    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("Story: US-OBS-032");
    expect(md).toContain("codex: accepted verdict=refine findings=1");
    expect(md).toContain("pi: failed unparseable");
  });
});
