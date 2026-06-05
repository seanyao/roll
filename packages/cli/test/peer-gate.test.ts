/**
 * FIX-150b — peer hard-trigger gate.
 *
 * The trigger is a RUNTIME mechanism (executor capture step), not skill text:
 * agent-agnostic, fires for every cycle, and a skipped consult on a
 * high-complexity delivery leaves an auditable ALERT + `peer:gate` event.
 * Soft by default: the gate records — it never fails or blocks the cycle.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  assessComplexity,
  peerEvidencePresent,
  runPeerGate,
} from "../src/runner/peer-gate.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-150b-${tag}-`)));
  dirs.push(d);
  return d;
}

describe("assessComplexity (pure classifier)", () => {
  it("≤3 files in one package → not high", () => {
    const v = assessComplexity(["packages/cli/src/a.ts", "packages/cli/src/b.ts", "packages/cli/test/a.test.ts"]);
    expect(v.high).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it(">3 files → high", () => {
    const v = assessComplexity(["a", "b", "c", "d"]);
    expect(v.high).toBe(true);
    expect(v.reasons.join()).toContain(">3");
  });

  it("two packages touched → cross-module high", () => {
    const v = assessComplexity(["packages/core/src/x.ts", "packages/cli/src/y.ts"]);
    expect(v.high).toBe(true);
    expect(v.reasons.join()).toContain("cross-module");
  });

  it("CI workflow or infra seam → high-risk high", () => {
    expect(assessComplexity([".github/workflows/ci.yml"]).high).toBe(true);
    expect(assessComplexity(["packages/infra/src/github.ts"]).high).toBe(true);
  });
});

describe("peerEvidencePresent", () => {
  it("finds cycle-<id>.* under <rt>/peer, false otherwise", () => {
    const rt = tmp("rt");
    expect(peerEvidencePresent(rt, "20260101-000000-1")).toBe(false);
    mkdirSync(join(rt, "peer"), { recursive: true });
    expect(peerEvidencePresent(rt, "20260101-000000-1")).toBe(false);
    writeFileSync(join(rt, "peer", "cycle-20260101-000000-1.md"), "AGREE\n");
    expect(peerEvidencePresent(rt, "20260101-000000-1")).toBe(true);
    expect(peerEvidencePresent(rt, "20260101-000000-2")).toBe(false);
  });
});

/** A worktree-shaped git repo whose branch is N files ahead of origin/main. */
function cycleWorktree(filesAhead: number): string {
  const proj = tmp("wt");
  const git = (cmd: string): void => {
    execSync(`git ${cmd}`, { cwd: proj, stdio: "pipe" });
  };
  git("init -q -b main");
  git("config user.email t@t");
  git("config user.name t");
  git("config commit.gpgsign false");
  writeFileSync(join(proj, "seed.txt"), "s\n");
  git("add -A");
  git('commit -q -m seed');
  // fabricate origin/main at the seed point (no network)
  git("update-ref refs/remotes/origin/main HEAD");
  git("checkout -q -b loop/cycle-x");
  for (let i = 0; i < filesAhead; i++) {
    writeFileSync(join(proj, `f${i}.txt`), `${i}\n`);
  }
  git("add -A");
  if (filesAhead > 0) git('commit -q -m "tcr: work"');
  return proj;
}

function sinks(): {
  alerts: string[];
  events: Array<{ cycleId: string; verdict: string; reasons: string[] }>;
  s: { alert: (m: string) => void; event: (p: { cycleId: string; verdict: string; reasons: string[] }) => void };
} {
  const alerts: string[] = [];
  const events: Array<{ cycleId: string; verdict: string; reasons: string[] }> = [];
  return { alerts, events, s: { alert: (m) => alerts.push(m), event: (p) => events.push(p) } };
}

describe("runPeerGate (end-to-end against a real git worktree)", () => {
  it("high-complexity + no evidence → skipped: ALERT + event, cycle untouched", async () => {
    const wt = cycleWorktree(5);
    const rt = tmp("rt");
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, rt, "c-1", s);
    expect(r.verdict).toBe("skipped");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("peer gate");
    expect(events).toEqual([{ cycleId: "c-1", verdict: "skipped", reasons: r.reasons }]);
  });

  it("high-complexity + evidence file → consulted: event only, no alert", async () => {
    const wt = cycleWorktree(5);
    const rt = tmp("rt");
    mkdirSync(join(rt, "peer"), { recursive: true });
    writeFileSync(join(rt, "peer", "cycle-c-2.md"), "[PEER_REVIEW] AGREE\n");
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, rt, "c-2", s);
    expect(r.verdict).toBe("consulted");
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("consulted");
  });

  it("small delivery → not-required: silent", async () => {
    const wt = cycleWorktree(1);
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, tmp("rt"), "c-3", s);
    expect(r.verdict).toBe("not-required");
    expect(alerts).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("non-repo worktree → never throws, not-required", async () => {
    const { s } = sinks();
    const r = await runPeerGate(tmp("plain"), tmp("rt"), "c-4", s);
    expect(r.verdict).toBe("not-required");
  });
});
