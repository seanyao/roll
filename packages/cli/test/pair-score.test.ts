/**
 * US-PAIR-010 — `roll pair score <story-id>`: the manual surface for the score
 * stage (US-PAIR-009). Reuses the runScorePairing adapter; pairing off / no
 * candidate / timeout degrade to a printed fallback hint with exit 0 (the
 * documented self-score path takes over). Injected reviewer spawn — tests never
 * launch a real agent.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pairScore, type PairScoreCmdDeps } from "../src/commands/pair.js";
import { readStorySelfScores } from "../src/lib/self-score.js";
import { selfScoreCommand } from "../src/commands/self-score.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SCORE_CFG = `enabled: true\nstages: [code, score]\ncapability:\n  claude: [code, score]\n  kimi: [code, score]\n`;

function project(yaml: string | null): string {
  const p = mkdtempSync(join(tmpdir(), "roll-pairscore-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll"), { recursive: true });
  if (yaml !== null) writeFileSync(join(p, ".roll", "pairing.yaml"), yaml);
  return p;
}

async function run(p: string, args: string[], deps?: Partial<PairScoreCmdDeps>): Promise<{ code: number; out: string; err: string }> {
  const old = process.cwd();
  process.chdir(p);
  let out = "";
  let err = "";
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
  try {
    const code = await pairScore(args, {
      installed: ["claude", "kimi"],
      isAvailable: () => true,
      workingAgent: () => "claude",
      spawnReviewer: async () => ({ status: "ok" as const, stdout: "SCORE: 8\nVERDICT: good\nRATIONALE: tidy delivery\n" }),
      ...deps,
    });
    return { code, out, err };
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
    process.chdir(old);
  }
}

describe("roll pair score — US-PAIR-010", () => {
  it("scores via the paired hetero agent and prints reviewer, score, note path", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "delivered the thing"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("kimi");
    expect(r.out).toContain("8");
    expect(r.out).toContain(join(".roll", "notes"));
    const notes = readStorySelfScores(p, "US-T-001");
    expect(notes).toHaveLength(1);
    const text = readFileSync(notes[0]?.sourcePath ?? "", "utf8");
    expect(text).toContain("scoring: pair");
    expect(text).toContain("scored-by: kimi");
  });

  it("pairing off → fallback hint, exit 0, no note", async () => {
    const p = project(null);
    const r = await run(p, ["US-T-001", "--summary", "s"]);
    expect(r.code).toBe(0);
    expect(r.out.toLowerCase()).toContain("fallback");
    expect(r.out).toContain("roll self-score");
    expect(readStorySelfScores(p, "US-T-001")).toHaveLength(0);
  });

  it("no heterogeneous candidate → fallback hint, exit 0", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "s"], { installed: ["claude"] });
    expect(r.code).toBe(0);
    expect(r.out).toContain("roll self-score");
  });

  it("reviewer timeout / protocol miss → fallback hint, exit 0", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "s"], {
      spawnReviewer: async () => ({ status: "ok" as const, stdout: "no protocol lines here" }),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("roll self-score");
  });

  it("usage failures: missing story id / unknown flag exit non-zero", async () => {
    const p = project(SCORE_CFG);
    expect((await run(p, [])).code).not.toBe(0);
    expect((await run(p, ["US-T-001", "--bogus", "x"])).code).not.toBe(0);
  });

  it("--file reads the summary from disk; missing summary sources fail loud", async () => {
    const p = project(SCORE_CFG);
    writeFileSync(join(p, "sum.txt"), "summary from file");
    expect((await run(p, ["US-T-001", "--file", "sum.txt"])).code).toBe(0);
    const r = await run(p, ["US-T-002"]); // no summary, no backlog row to derive from
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("summary");
  });
});

describe("roll self-score --fallback-reason — US-PAIR-010", () => {
  it("records the fallback reason in the note", async () => {
    const p = project(null);
    const old = process.cwd();
    process.chdir(p);
    try {
      const code = await selfScoreCommand(["roll-build", "US-T-001", "7", "ok", "shipped with caveats", "--fallback-reason", "pair scoring timed out"]);
      expect(code).toBe(0);
    } finally {
      process.chdir(old);
    }
    const notes = readStorySelfScores(p, "US-T-001");
    const text = readFileSync(notes[0]?.sourcePath ?? "", "utf8");
    expect(text).toContain("scoring: self");
    expect(text).toContain("fallback-reason: pair scoring timed out");
  });
});
