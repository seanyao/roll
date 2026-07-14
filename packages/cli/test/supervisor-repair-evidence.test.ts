/**
 * FIX-1061 — `roll supervisor` recognizes a Roll evaluator score for a loop PR
 * whose GitHub review is empty. Motivating incident: PR #1116, cycle
 * `20260701-020926-45747`, Pi score 9/good stored as a `cycle-*.score.pair.json`
 * peer artifact (never as a GitHub review). The manual-merge gate diagnostics
 * (`roll supervisor why`) must name the Roll evaluator source instead of the
 * generic `evaluator=none`, without bypassing red CI or a dirty merge.
 */
import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecPort } from "@roll/core";
import { readManualMergeGates, supervisorCommand } from "../src/commands/supervisor.js";

const CYCLE_ID = "20260701-020926-45747";
const BRANCH = `loop/cycle-${CYCLE_ID}`;
const PR = 1116;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Run supervisorCommand in a temp directory and capture stdout. */
function run(cwd: string, args: string[]): { code: number; out: string } {
  const save = process.cwd();
  const chunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
  process.chdir(cwd);
  let code = 1;
  try {
    code = supervisorCommand(args);
  } finally {
    process.chdir(save);
    process.stdout.write = realOut;
  }
  return { code, out: chunks.join("") };
}

/** Create a fake `gh` binary that returns the supplied PR state. */
function installFakeGh(
  cwd: string,
  opts: {
    number?: number;
    headRefName?: string;
    title?: string;
    body?: string;
    reviews?: unknown[];
    ci?: string;
    merge?: string;
    isDraft?: boolean;
    /** Raw statusCheckRollup array — overrides ci when set. */
    statusCheckRollup?: unknown[];
  } = {},
): string {
  const bin = join(cwd, "bin");
  mkdirSync(bin, { recursive: true });
  const ghPath = join(bin, "gh");
  const number = opts.number ?? PR;
  const headRefName = opts.headRefName ?? BRANCH;
  const title = opts.title ?? "FIX-1057 delivery";
  const body = opts.body ?? "Delivers FIX-1057.\\n\\n[roll:manual-merge]";
  const reviews = opts.reviews ?? [];
  const ci = opts.ci ?? "SUCCESS";
  const merge = opts.merge ?? "CLEAN";
  const isDraft = opts.isDraft ?? false;
  const rollup = opts.statusCheckRollup !== undefined
    ? JSON.stringify(opts.statusCheckRollup)
    : `[{"__typename":"CheckRun","name":"build","status":"COMPLETED","conclusion":"${ci}"}]`;
  writeFileSync(
    ghPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
      `  printf '%s\\n' '[{"number":${number},"headRefName":"${headRefName}","title":"${title}"}]'`,
      "  exit 0",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
      `  printf '%s\\n' '{"body":"${body}","labels":[],"reviews":${JSON.stringify(reviews)},"mergeStateStatus":"${merge}","statusCheckRollup":${rollup},"isDraft":${isDraft},"headRefName":"${headRefName}"}'`,
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(ghPath, 0o755);
  return bin;
}

function withPath<T>(prefix: string, fn: () => T): T {
  const previous = process.env["PATH"];
  process.env["PATH"] = `${prefix}:${previous ?? ""}`;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env["PATH"];
    else process.env["PATH"] = previous;
  }
}

/** FIX-1062 project fixture with optional durable events. */
function project1062(events: string[] = []): string {
  const d = mkdtempSync(join(tmpdir(), "roll-fix1062-"));
  dirs.push(d);
  mkdirSync(join(d, ".roll", "loop"), { recursive: true });
  writeFileSync(
    join(d, ".roll", "backlog.md"),
    `# Backlog\n\n| ID | Description | Status |\n| --- | --- | --- |\n| FIX-1057 | delivery | 📋 Todo |\n`,
  );
  if (events.length > 0) {
    writeFileSync(join(d, ".roll", "loop", "events.ndjson"), events.join("\n") + "\n");
  }
  return d;
}

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
            statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: ci }],
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

describe("repair-evidence command — FIX-1062 idempotency", () => {
  it("returns already_repaired for a PR with an evidence:repaired event and no GitHub review", () => {
    const cwd = project1062([
      JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 }),
      JSON.stringify({ type: "evidence:repaired", prNumber: PR, storyId: "FIX-1057", outcome: "evidence-generated", details: "repaired", ts: 2 }),
    ]);
    const fakeBin = installFakeGh(cwd, { reviews: [], ci: "SUCCESS", merge: "CLEAN" });
    const r = withPath(fakeBin, () => run(cwd, ["repair-evidence", String(PR), "--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(parsed.verdict).toBe("already_repaired");
    expect(parsed.storyId).toBe("FIX-1057");
  });

  it("preserves not_reparable for an unrepaired PR with no evaluator approval", () => {
    const cwd = project1062([JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 })]);
    const fakeBin = installFakeGh(cwd, { reviews: [], ci: "SUCCESS", merge: "CLEAN" });
    const r = withPath(fakeBin, () => run(cwd, ["repair-evidence", String(PR), "--json"]));
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.out);
    expect(parsed.verdict).toBe("not_reparable");
    expect(parsed.reason).toContain("evaluator has not approved");
  });

  it("FIX-1204: repairs a non-manual green approved PR instead of saying nothing to repair", () => {
    const cwd = project1062([JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 })]);
    const fakeBin = installFakeGh(cwd, {
      body: "Delivers FIX-1057.",
      reviews: [{ authorAssociation: "BOT", state: "APPROVED" }],
      ci: "SUCCESS",
      merge: "CLEAN",
    });
    const r = withPath(fakeBin, () => run(cwd, ["repair-evidence", String(PR), "--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(parsed.verdict).toBe("repaired");
    expect(parsed.storyId).toBe("FIX-1057");
  });
});

describe("supervisor why — FIX-1062 repaired evidence diagnostic", () => {
  it("does not summarize a repaired PR as bare evaluator=none", () => {
    const cwd = project1062([
      JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 }),
      JSON.stringify({ type: "evidence:repaired", prNumber: PR, storyId: "FIX-1057", outcome: "evidence-generated", details: "repaired", ts: 2 }),
    ]);
    const fakeBin = installFakeGh(cwd, { reviews: [], ci: "SUCCESS", merge: "CLEAN" });
    const r = withPath(fakeBin, () => run(cwd, ["why"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("manual merge:");
    expect(r.out).toContain("merge_ready");
    expect(r.out).not.toMatch(/evaluator=none[^)]/); // bare evaluator=none, not followed by repaired annotation
    expect(r.out).toContain("repaired");
  });

  it("--json exposes the repaired gate detail without bare evaluator=none", () => {
    const cwd = project1062([
      JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 }),
      JSON.stringify({ type: "evidence:repaired", prNumber: PR, storyId: "FIX-1057", outcome: "evidence-generated", details: "repaired", ts: 2 }),
    ]);
    const fakeBin = installFakeGh(cwd, { reviews: [], ci: "SUCCESS", merge: "CLEAN" });
    const r = withPath(fakeBin, () => run(cwd, ["why", "--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    const gate = parsed.runbook.truth.manualMergeGates.find((g: { prNumber: number }) => g.prNumber === PR);
    expect(gate).toBeDefined();
    expect(gate.action).toBe("merge_ready");
    expect(gate.detail).toContain("repaired");
    expect(gate.detail).not.toBe("evaluator=none");
  });
});

describe("FIX-1252 — ciState recognizes both CheckRun and StatusContext", () => {
  const BOT_APPROVED = [{ authorAssociation: "BOT", state: "APPROVED" }];

  it("pure CheckRun green → success", () => {
    const cwd = project1062([JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 })]);
    const fakeBin = installFakeGh(cwd, {
      reviews: BOT_APPROVED,
      merge: "CLEAN",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      ],
    });
    const r = withPath(fakeBin, () => run(cwd, ["repair-evidence", String(PR), "--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(parsed.verdict).toBe("repaired");
  });

  it("pure StatusContext green → success", () => {
    const cwd = project1062([JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 })]);
    const fakeBin = installFakeGh(cwd, {
      reviews: BOT_APPROVED,
      merge: "CLEAN",
      statusCheckRollup: [
        { __typename: "StatusContext", context: "vercel", state: "SUCCESS" },
      ],
    });
    const r = withPath(fakeBin, () => run(cwd, ["repair-evidence", String(PR), "--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(parsed.verdict).toBe("repaired");
  });

  it("mixed CheckRun + StatusContext all green → success", () => {
    const cwd = project1062([JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 })]);
    const fakeBin = installFakeGh(cwd, {
      reviews: BOT_APPROVED,
      merge: "CLEAN",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "StatusContext", context: "vercel", state: "SUCCESS" },
      ],
    });
    const r = withPath(fakeBin, () => run(cwd, ["repair-evidence", String(PR), "--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(parsed.verdict).toBe("repaired");
  });

  it("mixed with red (StatusContext failure) → not reparable", () => {
    const cwd = project1062([JSON.stringify({ type: "pr:open", prNumber: PR, storyId: "FIX-1057", ts: 1 })]);
    const fakeBin = installFakeGh(cwd, {
      reviews: BOT_APPROVED,
      merge: "CLEAN",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "StatusContext", context: "vercel", state: "FAILURE" },
      ],
    });
    const r = withPath(fakeBin, () => run(cwd, ["repair-evidence", String(PR), "--json"]));
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.out);
    expect(parsed.verdict).toBe("not_reparable");
  });
});
