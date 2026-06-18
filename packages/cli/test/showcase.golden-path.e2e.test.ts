/**
 * US-SHOW-001 — the golden-path STANDARD E2E (real models).
 *
 * This is a first-class test in the suite, but it needs REAL agents
 * (builder=kimi / reviewer=reasonix / scorer=pi) and a real loop run, so it is
 * GATED behind `ROLL_SHOWCASE=1`. The normal `roll test` / per-commit suite
 * SKIPS it (determinism); the operator runs it with the flag to validate the
 * live golden path (and to refresh the investor-demo evidence each release).
 *
 *   ROLL_SHOWCASE=1 pnpm --filter @roll/cli exec vitest run test/showcase.golden-path.e2e.test.ts
 *
 * It asserts the STRUCTURE + INVARIANTS of a completed showcase run — NOT the
 * agents' specific output (kimi's exact code is non-deterministic). It runs
 * `roll showcase --json --keep-sandbox` against a project that carries the
 * target card, then asserts the evidence-chain structure:
 *   - builder / reviewer / scorer are 3 distinct REAL agents (heterogeneous);
 *   - TCR commit(s) with a test-pass proof exist;
 *   - per-AC CLI + web screenshot files exist (real, non-empty);
 *   - the attest report Gate is PASS;
 *   - US-DEMO-001 flipped to Done; truth.json reflects attested;
 *   - the same card number appears across surfaces.
 *
 * Any missing link is a FAIL (the showcase verdict already enforces this; the
 * test re-asserts the structure so a regression in the chain assembly is caught
 * independently of the command's own verdict).
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCasting } from "../src/lib/showcase.js";

const GATED = process.env["ROLL_SHOWCASE"] === "1";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const rollBin = join(repoRoot, "packages", "cli", "bin", "roll.js");

/** The project the showcase runs against — the card source. Defaults to the
 *  reference checkout; override with ROLL_SHOWCASE_PROJECT for the operator's tree. */
const PROJECT = process.env["ROLL_SHOWCASE_PROJECT"] ?? repoRoot;

interface ShowcaseReport {
  card: string;
  casting: { builder: string; reviewer: string; scorer: string };
  run: {
    tcrCommits: { sha: string; subject: string; testPass: boolean }[];
    reviewRecord?: { reviewer: string; scorer: string; recorded: boolean };
    screenshots: { surface: "cli" | "web"; path: string; present: boolean; skipped?: string }[];
    attest?: { gate: "PASS" | "SKIP" | "FAIL" };
    backlogStatus?: string;
    truthLadder?: string;
  };
  chain: { links: { key: string; present: boolean; detail: string }[]; sameNumber?: string };
  verdict: { pass: boolean; missing: { key: string }[]; total: number; present: number };
}

function runShowcase(): ShowcaseReport {
  // The showcase emits the JSON report on stdout regardless of its verdict, then
  // exits 0 (PASS) or 1 (FAIL/abort). execFileSync throws on a non-zero exit, so
  // capture stdout from the thrown error too — the structural assertions read
  // the report, and the verdict assertion checks `verdict.pass` itself.
  let out: string;
  try {
    out = execFileSync(
      process.execPath,
      [rollBin, "showcase", "--json", "--keep-sandbox", "--card", "US-DEMO-001"],
      { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ROLL_LANG: "en" } },
    );
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? "";
  }
  // The JSON report is the JSON object on stdout.
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`showcase emitted no JSON report:\n${out}`);
  return JSON.parse(out.slice(start)) as ShowcaseReport;
}

function nonEmpty(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
}

describe.skipIf(!GATED)("US-SHOW-001 golden-path standard E2E (real models)", () => {
  // ONE real run; all invariants assert against its report.
  const report = GATED ? runShowcase() : (undefined as unknown as ShowcaseReport);

  it("casts three distinct, heterogeneous REAL agents (builder ≠ reviewer ≠ scorer)", () => {
    const { builder, reviewer, scorer } = report.casting;
    expect(new Set([builder, reviewer, scorer]).size).toBe(3);
    expect(validateCasting(report.casting).ok).toBe(true);
    expect(report.run.reviewRecord?.recorded).toBe(true);
  });

  it("produced TCR commit(s) carrying a test-pass proof", () => {
    const green = report.run.tcrCommits.filter((c) => c.testPass);
    expect(green.length).toBeGreaterThan(0);
  });

  it("captured real, non-empty per-AC CLI + web screenshot files", () => {
    const cli = report.run.screenshots.find((s) => s.surface === "cli");
    const web = report.run.screenshots.find((s) => s.surface === "web");
    expect(cli?.present).toBe(true);
    expect(web?.present).toBe(true);
    expect(nonEmpty(cli!.path)).toBe(true);
    expect(nonEmpty(web!.path)).toBe(true);
  });

  it("the attest report Gate is PASS", () => {
    expect(report.run.attest?.gate).toBe("PASS");
  });

  it("US-DEMO-001 flipped to Done and truth.json reflects attested", () => {
    expect((report.run.backlogStatus ?? "").toLowerCase()).toContain("done");
    expect(report.run.truthLadder).toBe("attested");
  });

  it("the same card number appears across surfaces", () => {
    expect(report.chain.sameNumber).toBe("US-DEMO-001");
  });

  it("the full evidence chain is present and the verdict is PASS", () => {
    const missing = report.chain.links.filter((l) => !l.present).map((l) => l.key);
    expect(missing).toEqual([]);
    expect(report.verdict.pass).toBe(true);
    expect(report.verdict.present).toBe(report.verdict.total);
  });
});
