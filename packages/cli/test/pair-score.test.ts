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
  it("scores via a fresh-session peer and prints reviewer, score, note path", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "delivered the thing"]);
    expect(r.code).toBe(0);
    // FIX-343: any installed agent is a valid fresh-session scorer (claude OR
    // kimi) — the round-robin head varies by cycle id, so assert membership.
    expect(r.out).toMatch(/claude|kimi/);
    expect(r.out).toContain("8");
    expect(r.out).toContain(join(".roll", "notes"));
    const notes = readStorySelfScores(p, "US-T-001");
    expect(notes).toHaveLength(1);
    const text = readFileSync(notes[0]?.sourcePath ?? "", "utf8");
    expect(text).toContain("scoring: pair");
    expect(text).toMatch(/scored-by: (claude|kimi)/);
  });

  it("FIX-343: MANDATORY — no pairing.yaml still scores via a fresh-session peer, exit 0", async () => {
    // The score stage is no longer gated on pairing.yaml: with installed agents
    // present, a fresh-session peer scores even without a config.
    const p = project(null);
    const r = await run(p, ["US-T-001", "--summary", "s"]);
    expect(r.code).toBe(0);
    const notes = readStorySelfScores(p, "US-T-001");
    expect(notes).toHaveLength(1);
    expect(readFileSync(notes[0]?.sourcePath ?? "", "utf8")).toContain("scoring: pair");
  });

  it("FIX-343: single-agent env scores via a fresh SAME-TYPE session, exit 0", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "s"], { installed: ["claude"] });
    expect(r.code).toBe(0);
    const notes = readStorySelfScores(p, "US-T-001");
    expect(notes).toHaveLength(1);
    expect(readFileSync(notes[0]?.sourcePath ?? "", "utf8")).toContain("scored-by: claude");
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

describe("codex pair-review fixes — US-PAIR-010", () => {
  it("--skill overrides the prefix heuristic (design sessions)", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "design session", "--skill", "roll-design"]);
    expect(r.code).toBe(0);
    const text = readFileSync(readStorySelfScores(p, "US-T-001")[0]?.sourcePath ?? "", "utf8");
    expect(text).toContain("skill: roll-design");
  });

  it("FIX-343: --worker no longer restricts scoring to a heterogeneous peer (same-vendor fresh is valid)", async () => {
    const p = project(SCORE_CFG);
    // worker kimi: the score stage allows ANY installed agent as a fresh-session
    // scorer (claude OR a fresh kimi) — independence is the fresh session, not
    // vendor heterogeneity. A pair score is produced regardless.
    const r = await run(p, ["US-T-001", "--summary", "s", "--worker", "kimi"]);
    expect(r.code).toBe(0);
    const text = readFileSync(readStorySelfScores(p, "US-T-001")[0]?.sourcePath ?? "", "utf8");
    expect(text).toContain("scoring: pair");
    expect(text).toMatch(/scored-by: (claude|kimi)/);
  });

  it("backlog row fallback never matches a longer id (US-X-1 vs US-X-10)", async () => {
    const p = project(SCORE_CFG);
    writeFileSync(join(p, ".roll", "backlog.md"), "| US-T-0010 | the other story | Todo |\n| US-T-001 | the right story | Todo |\n");
    const r = await run(p, ["US-T-001"]);
    expect(r.code).toBe(0);
  });

  it("a retry that adds a fallback reason writes a new audited note", async () => {
    const p = project(null);
    const old = process.cwd();
    process.chdir(p);
    try {
      await selfScoreCommand(["roll-build", "US-T-009", "7", "ok", "same rationale"]);
      await selfScoreCommand(["roll-build", "US-T-009", "7", "ok", "same rationale", "--fallback-reason", "pair timed out"]);
    } finally {
      process.chdir(old);
    }
    const notes = readStorySelfScores(p, "US-T-009");
    expect(notes).toHaveLength(2);
    const latest = readFileSync(notes[1]?.sourcePath ?? "", "utf8");
    expect(latest).toContain("fallback-reason: pair timed out");
  });
});
