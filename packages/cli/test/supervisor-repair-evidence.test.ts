/**
 * FIX-1061 — `roll supervisor` recognizes a Roll evaluator score for a loop PR
 * whose GitHub review is empty. Motivating incident: PR #1116, cycle
 * `20260701-020926-45747`, Pi score 9/good stored as a `cycle-*.score.pair.json`
 * peer artifact (never as a GitHub review). The manual-merge gate diagnostics
 * (`roll supervisor why`) must name the Roll evaluator source instead of the
 * generic `evaluator=none`, without bypassing red CI or a dirty merge.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecPort } from "@roll/core";
import { readManualMergeGates } from "../src/commands/supervisor.js";

const CYCLE_ID = "20260701-020926-45747";
const BRANCH = `loop/cycle-${CYCLE_ID}`;
const PR = 1116;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A project with the PR #1116 Roll evaluator score artifact on disk. */
function project(scoreArtifact?: unknown): string {
  const d = mkdtempSync(join(tmpdir(), "roll-fix1061-"));
  dirs.push(d);
  mkdirSync(join(d, ".roll", "loop", "peer"), { recursive: true });
  if (scoreArtifact !== undefined) {
    writeFileSync(
      join(d, ".roll", "loop", "peer", `cycle-${CYCLE_ID}.score.pair.json`),
      JSON.stringify(scoreArtifact),
    );
  }
  return d;
}

/** A gh fake mirroring PR #1116: manual-merge, empty GitHub reviews, and the
 *  supplied CI / merge state. */
function ghPort(opts: { ci?: string; merge?: string } = {}): ExecPort {
  const ci = opts.ci ?? "SUCCESS";
  const merge = opts.merge ?? "CLEAN";
  return {
    run(tool: string, argv: readonly string[]) {
      if (tool !== "gh") return { stdout: "", code: 1 };
      if (argv[0] === "pr" && argv[1] === "list") {
        return { stdout: JSON.stringify([{ number: PR, headRefName: BRANCH, title: "FIX-1057 delivery" }]), code: 0 };
      }
      if (argv[0] === "pr" && argv[1] === "view") {
        return {
          stdout: JSON.stringify({
            reviews: [], // no GitHub review — the FIX-1061 incident
            statusCheckRollup: [{ conclusion: ci }],
            mergeStateStatus: merge,
            body: "Delivers FIX-1057.\n\n[roll:manual-merge]",
            labels: [],
            isDraft: true,
          }),
          code: 0,
        };
      }
      return { stdout: "", code: 1 };
    },
  };
}

describe("readManualMergeGates — FIX-1061 Roll evaluator source", () => {
  it("names roll-score when PR #1116 carries a 9/good peer score and no GitHub review", () => {
    const d = project({ cycleId: CYCLE_ID, peer: "pi", stage: "score", score: 9, verdict: "good" });
    const gates = readManualMergeGates(d, [], ghPort());
    expect(gates).toHaveLength(1);
    const gate = gates[0]!;
    expect(gate.prNumber).toBe(PR);
    expect(gate.detail).toContain("roll-score");
    expect(gate.detail).toContain("9/10");
    expect(gate.detail).not.toContain("evaluator=none");
  });

  it("falls back to a pair:score event when the artifact file is absent", () => {
    const d = project(); // no artifact on disk
    const events = [
      { type: "pair:score", cycleId: CYCLE_ID, peer: "pi", score: 8, verdict: "good", cost: 0, stage: "score", ts: 1 },
    ] as unknown as Parameters<typeof readManualMergeGates>[1];
    const gates = readManualMergeGates(d, events, ghPort());
    expect(gates[0]!.detail).toContain("roll-score");
    expect(gates[0]!.detail).toContain("8/10");
  });

  it("reports evaluator=none when there is no Roll score and no GitHub review", () => {
    const d = project(); // no artifact
    const gates = readManualMergeGates(d, [], ghPort());
    expect(gates[0]!.detail).toContain("evaluator=none");
  });

  it("rejects a regression peer score (source stays none)", () => {
    const d = project({ cycleId: CYCLE_ID, peer: "pi", stage: "score", score: 9, verdict: "regression" });
    const gates = readManualMergeGates(d, [], ghPort());
    expect(gates[0]!.detail).toContain("evaluator=none");
  });

  it("does not treat a Roll score as CI or merge readiness (red CI still surfaces)", () => {
    const d = project({ cycleId: CYCLE_ID, peer: "pi", stage: "score", score: 9, verdict: "good" });
    const gates = readManualMergeGates(d, [], ghPort({ ci: "FAILURE" }));
    // The Roll score is still named, but the action reflects red CI — the score
    // never bypasses CI state in the diagnostics.
    expect(gates[0]!.detail).toContain("roll-score");
    expect(gates[0]!.ciState).not.toBe("success");
  });
});
