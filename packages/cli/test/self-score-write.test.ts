/**
 * FIX-274 — the self-score writer must be TS-native.
 *
 * The v2 contract told agents to `source "$(command -v roll)"` and call the
 * bash function `_skill_write_self_score`. v3's installed `roll` is a bundled
 * TS CLI: sourcing it executes JS as shell and the function never exists. The
 * suite freezes (a) that failure mode, (b) the new writer's observable
 * contract, and (c) that no active skill contract still advertises the dead
 * path.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeSelfScoreNote } from "../src/lib/self-score.js";
import { readLatestStorySelfScore, readStorySelfScores } from "../src/lib/self-score.js";
import { selfScoreCommand } from "../src/commands/self-score.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-selfscore-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll"), { recursive: true });
  return p;
}

function withCard(p: string, epic: string, id: string): void {
  mkdirSync(join(p, ".roll", "features", epic, id), { recursive: true });
  writeFileSync(join(p, ".roll", "features", epic, id, "spec.md"), `# ${id}\n`);
  writeFileSync(join(p, ".roll", "index.json"), JSON.stringify({ [id]: epic }));
}

const PAYLOAD = {
  skill: "roll-fix",
  story: "FIX-900",
  score: 9,
  verdict: "good" as const,
  rationale: "clean root-cause fix with regression test",
  ts: "2026-06-13T03:00:00Z",
};

describe("FIX-274 failure-mode reproduction", () => {
  it("sourcing a TS/ESM bundle cannot expose _skill_write_self_score", () => {
    const p = project();
    const fakeRoll = join(p, "roll");
    writeFileSync(fakeRoll, '#!/usr/bin/env node\nimport { x } from "./lib.js";\nconsole.log(x);\n');
    const r = spawnSync("bash", ["-c", `source '${fakeRoll}' >/dev/null 2>&1; type _skill_write_self_score`], {
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0); // the documented v2 command path is dead
  });
});

describe("writeSelfScoreNote", () => {
  it("writes a card-local note that existing readers parse back", () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    const res = writeSelfScoreNote(p, PAYLOAD);
    expect(res.written).toBe(true);
    expect(res.path).toContain(join(".roll", "features", "goal-mode", "FIX-900", "notes"));
    const text = readFileSync(res.path, "utf8");
    expect(text).toContain("skill: roll-fix");
    expect(text).toContain("story: FIX-900");
    expect(text).toContain("score: 9");
    expect(text).toContain("verdict: good");
    expect(text).toContain("ts: 2026-06-13T03:00:00Z");
    expect(text).toContain(PAYLOAD.rationale);
    const entry = readLatestStorySelfScore(p, "FIX-900");
    expect(entry).toBeDefined();
    expect(entry?.score).toBe(9);
    expect(entry?.verdict).toBe("good");
    expect(entry?.skill).toBe("roll-fix");
    expect(entry?.note).toContain("clean root-cause fix");
  });

  it("falls back to .roll/notes/ when no card folder exists", () => {
    const p = project();
    const res = writeSelfScoreNote(p, { ...PAYLOAD, story: "US-NOCARD-001" });
    expect(res.path).toContain(join(".roll", "notes"));
    expect(existsSync(res.path)).toBe(true);
    expect(readStorySelfScores(p, "US-NOCARD-001")).toHaveLength(1);
  });

  it("is idempotent: same payload re-run keeps a single note", () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    const first = writeSelfScoreNote(p, PAYLOAD);
    const second = writeSelfScoreNote(p, PAYLOAD);
    expect(second.written).toBe(false);
    expect(second.path).toBe(first.path);
    const notesDir = join(p, ".roll", "features", "goal-mode", "FIX-900", "notes");
    expect(readdirSync(notesDir)).toHaveLength(1);
  });

  it("is idempotent across retries without an explicit ts (agent retry path)", () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    const { ts: _ts, ...noTs } = PAYLOAD;
    const first = writeSelfScoreNote(p, noTs);
    const second = writeSelfScoreNote(p, noTs);
    expect(second.written).toBe(false);
    expect(second.path).toBe(first.path);
    const notesDir = join(p, ".roll", "features", "goal-mode", "FIX-900", "notes");
    expect(readdirSync(notesDir)).toHaveLength(1);
    // a genuinely different self-score (new rationale) is NOT swallowed
    const third = writeSelfScoreNote(p, { ...noTs, score: 8, rationale: "second cycle after review fixes" });
    expect(third.written).toBe(true);
  });

  it("rejects a contradictory rewrite of the same skill/story/ts", () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    writeSelfScoreNote(p, PAYLOAD);
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, score: 3, verdict: "ok" })).toThrow(/contradict/i);
  });

  it("fails loud on invalid inputs", () => {
    const p = project();
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, score: 0 })).toThrow(/score/i);
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, score: 11 })).toThrow(/score/i);
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, score: 7.5 })).toThrow(/score/i);
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, verdict: "great" as never })).toThrow(/verdict/i);
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, rationale: "  " })).toThrow(/rationale/i);
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, skill: "" })).toThrow(/skill/i);
    expect(() => writeSelfScoreNote(p, { ...PAYLOAD, story: "" })).toThrow(/story/i);
  });

  it("US-PAIR-009: provenance fields land in frontmatter and readers stay compatible", () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    const res = writeSelfScoreNote(p, { ...PAYLOAD, scoredBy: "codex", scoring: "pair" });
    const text = readFileSync(res.path, "utf8");
    expect(text).toContain("scored-by: codex");
    expect(text).toContain("scoring: pair");
    const entry = readLatestStorySelfScore(p, "FIX-900");
    expect(entry?.score).toBe(9); // reader unaffected by extra fields
  });

  it("US-PAIR-009: defaults to scoring: self and records a fallback reason", () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    const res = writeSelfScoreNote(p, { ...PAYLOAD, fallbackReason: "no heterogeneous candidate" });
    const text = readFileSync(res.path, "utf8");
    expect(text).toContain("scoring: self");
    expect(text).toContain("fallback-reason: no heterogeneous candidate");
  });

  it("refuses to write outside a roll project (no stray .roll/ minting)", () => {
    const p = mkdtempSync(join(tmpdir(), "roll-noproject-"));
    dirs.push(p);
    expect(() => writeSelfScoreNote(p, PAYLOAD)).toThrow(/not a roll project/i);
    expect(existsSync(join(p, ".roll"))).toBe(false);
  });

  it("two writers for different stories never collide", () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    const a = writeSelfScoreNote(p, PAYLOAD);
    const b = writeSelfScoreNote(p, { ...PAYLOAD, story: "FIX-901" });
    expect(a.path).not.toBe(b.path);
    expect(readStorySelfScores(p, "FIX-900")).toHaveLength(1);
    expect(readStorySelfScores(p, "FIX-901")).toHaveLength(1);
  });
});

describe("roll self-score command", () => {
  async function inProject(p: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
    const old = process.cwd();
    process.chdir(p);
    let out = "";
    let err = "";
    const so = process.stdout.write.bind(process.stdout);
    const se = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
    try {
      const code = await selfScoreCommand(args);
      return { code, out, err };
    } finally {
      process.stdout.write = so;
      process.stderr.write = se;
      process.chdir(old);
    }
  }

  it("writes a note and prints the written path", async () => {
    const p = project();
    withCard(p, "goal-mode", "FIX-900");
    const r = await inProject(p, ["roll-fix", "FIX-900", "9", "good", "clean fix, regression covered"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(join("features", "goal-mode", "FIX-900", "notes"));
    expect(readStorySelfScores(p, "FIX-900")).toHaveLength(1);
  });

  it("fails with usage on missing or invalid args", async () => {
    const p = project();
    const missing = await inProject(p, ["roll-fix", "FIX-900"]);
    expect(missing.code).not.toBe(0);
    expect(missing.err).toContain("Usage");
    const bad = await inProject(p, ["roll-fix", "FIX-900", "twelve", "good", "x"]);
    expect(bad.code).not.toBe(0);
  });
});

describe("skill contracts no longer source the CLI bundle", () => {
  const skillsRoot = join(__dirname, "..", "..", "..", "skills");

  it.each(["roll-build", "roll-fix", "roll-design"])("%s contract calls the TS-native path", (skill) => {
    const contract = readFileSync(join(skillsRoot, skill, "references", "full-contract.md"), "utf8");
    expect(contract).not.toMatch(/source "\$\(command -v roll\)"[\s\S]{0,200}_skill_write_self_score/);
    expect(contract).toContain("roll self-score");
  });
});
