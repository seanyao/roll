/**
 * US-PAIR-010 / FIX-343 — `roll pair score <story-id>`: the manual surface for
 * the score stage (US-PAIR-009). Reuses the runScorePairing adapter; the working
 * agent NEVER grades its own work, so a no-candidate / timeout outcome is
 * FAIL-LOUD (no peer = no Review Score, exit non-zero), not a self-grade fallback.
 * Injected reviewer spawn — tests never launch a real agent.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pairScore, type PairScoreCmdDeps } from "../src/commands/pair.js";
import { readStoryReviewScores, writeReviewScoreNote } from "../src/lib/review-score.js";

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
    const notes = readStoryReviewScores(p, "US-T-001");
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
    const notes = readStoryReviewScores(p, "US-T-001");
    expect(notes).toHaveLength(1);
    expect(readFileSync(notes[0]?.sourcePath ?? "", "utf8")).toContain("scoring: pair");
  });

  it("FIX-343: single-agent env scores via a fresh SAME-TYPE session, exit 0", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "s"], { installed: ["claude"] });
    expect(r.code).toBe(0);
    const notes = readStoryReviewScores(p, "US-T-001");
    expect(notes).toHaveLength(1);
    expect(readFileSync(notes[0]?.sourcePath ?? "", "utf8")).toContain("scored-by: claude");
  });

  it("FIX-343: reviewer timeout / protocol miss → FAIL LOUD (no Review Score, exit non-zero, no self-grade escape)", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "s"], {
      spawnReviewer: async () => ({ status: "ok" as const, stdout: "no protocol lines here" }),
    });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("No Review Score produced");
    // No note is synthesized when the peer can't score.
    expect(readStoryReviewScores(p, "US-T-001")).toHaveLength(0);
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

describe("codex pair-review fixes — US-PAIR-010", () => {
  it("--skill overrides the prefix heuristic (design sessions)", async () => {
    const p = project(SCORE_CFG);
    const r = await run(p, ["US-T-001", "--summary", "design session", "--skill", "roll-design"]);
    expect(r.code).toBe(0);
    const text = readFileSync(readStoryReviewScores(p, "US-T-001")[0]?.sourcePath ?? "", "utf8");
    expect(text).toContain("skill: roll-design");
  });

  it("FIX-343: --worker no longer restricts scoring to a heterogeneous peer (same-vendor fresh is valid)", async () => {
    const p = project(SCORE_CFG);
    // worker kimi: the score stage allows ANY installed agent as a fresh-session
    // scorer (claude OR a fresh kimi) — independence is the fresh session, not
    // vendor heterogeneity. A pair score is produced regardless.
    const r = await run(p, ["US-T-001", "--summary", "s", "--worker", "kimi"]);
    expect(r.code).toBe(0);
    const text = readFileSync(readStoryReviewScores(p, "US-T-001")[0]?.sourcePath ?? "", "utf8");
    expect(text).toContain("scoring: pair");
    expect(text).toMatch(/scored-by: (claude|kimi)/);
  });

  it("backlog row fallback never matches a longer id (US-X-1 vs US-X-10)", async () => {
    const p = project(SCORE_CFG);
    writeFileSync(join(p, ".roll", "backlog.md"), "| US-T-0010 | the other story | Todo |\n| US-T-001 | the right story | Todo |\n");
    const r = await run(p, ["US-T-001"]);
    expect(r.code).toBe(0);
  });

  it("a retry that adds an audit field (fallback-reason) writes a new audited note, not a dedup", () => {
    const p = project(null);
    // The writer's idempotency must NOT swallow a retry that now carries an audit
    // field the prior note lacked (reusing would lose the audit). Exercise the
    // writer directly (the agent-facing self-grade command is removed in FIX-343).
    writeReviewScoreNote(p, { skill: "roll-build", story: "US-T-009", score: 7, verdict: "ok", rationale: "same rationale", scoring: "pair", scoredBy: "kimi" });
    writeReviewScoreNote(p, { skill: "roll-build", story: "US-T-009", score: 7, verdict: "ok", rationale: "same rationale", scoring: "pair", scoredBy: "kimi", fallbackReason: "pair timed out" });
    const notes = readStoryReviewScores(p, "US-T-009");
    expect(notes).toHaveLength(2);
    const latest = readFileSync(notes[1]?.sourcePath ?? "", "utf8");
    expect(latest).toContain("fallback-reason: pair timed out");
  });
});
