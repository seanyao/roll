/**
 * FIX-150b / FIX-293 — peer hard-trigger gate.
 *
 * The trigger is a RUNTIME mechanism (executor capture step), not skill text:
 * agent-agnostic, fires for every cycle, and a skipped consult on a
 * high-complexity delivery leaves an auditable ALERT + `peer:gate` event.
 *
 * FIX-293: the gate now has teeth. HARD by default — a high-complexity delivery
 * with no peer evidence is BLOCKED (`blocked: true`); `soft` keeps the legacy
 * record-only behaviour. `readPeerGateMode` reads the policy flag (default hard).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  assessComplexity,
  peerEvidencePresent,
  readPeerGateMode,
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
  it("hard + high-complexity + no evidence → skipped & BLOCKED: ALERT + event", async () => {
    const wt = cycleWorktree(5);
    const rt = tmp("rt");
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, rt, "c-1", "hard", s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true); // FIX-293 AC-H2: the cycle is blocked, not self-graded
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("peer gate (hard)");
    expect(alerts[0]).toContain("retrying");
    expect(events).toEqual([{ cycleId: "c-1", verdict: "skipped", reasons: r.reasons }]);
  });

  it("soft + high-complexity + no evidence → skipped but NOT blocked (legacy)", async () => {
    const wt = cycleWorktree(5);
    const rt = tmp("rt");
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, rt, "c-1s", "soft", s);
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(false); // soft only records — the migration window
    expect(alerts[0]).toContain("peer gate (soft)");
    expect(alerts[0]).not.toContain("retrying");
    expect(events[0]?.verdict).toBe("skipped");
  });

  it("high-complexity + evidence file → consulted: event only, no alert, never blocked", async () => {
    const wt = cycleWorktree(5);
    const rt = tmp("rt");
    mkdirSync(join(rt, "peer"), { recursive: true });
    writeFileSync(join(rt, "peer", "cycle-c-2.md"), "[PEER_REVIEW] AGREE\n");
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, rt, "c-2", "hard", s);
    expect(r.verdict).toBe("consulted");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events[0]?.verdict).toBe("consulted");
  });

  it("small delivery → not-required: silent, never blocked (hard or soft)", async () => {
    const wt = cycleWorktree(1);
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, tmp("rt"), "c-3", "hard", s);
    expect(r.verdict).toBe("not-required");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("non-repo worktree → never throws, not-required, not blocked", async () => {
    const { s } = sinks();
    const r = await runPeerGate(tmp("plain"), tmp("rt"), "c-4", "hard", s);
    expect(r.verdict).toBe("not-required");
    expect(r.blocked).toBe(false);
  });
});

describe("runPeerGate — FIX-312 hetero-availability drives the decision", () => {
  it("heteroAvailable=true + self-reviewed (no evidence) → BLOCKED even for a SMALL delivery", async () => {
    // AC3/AC5: with a hetero peer available, the hard block extends to ALL
    // substantive deliveries — a 1-file (low-complexity) self-reviewed cycle is a
    // VIOLATION, not "not-required".
    const wt = cycleWorktree(1);
    const rt = tmp("rt");
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, rt, "h-1", "hard", s, { heteroAvailable: true });
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
    expect(r.heteroAvailable).toBe(true);
    expect(alerts[0]).toContain("heterogeneous peer was available");
    expect(events[0]?.verdict).toBe("skipped");
    expect(events[0]?.reasons[0]).toBe("hetero_available_self_review_violation");
  });

  it("heteroAvailable=true + high-complexity + self-reviewed → BLOCKED (violation)", async () => {
    const wt = cycleWorktree(5);
    const rt = tmp("rt");
    const { s } = sinks();
    const r = await runPeerGate(wt, rt, "h-2", "hard", s, { heteroAvailable: true });
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(true);
  });

  it("heteroAvailable=true + peer evidence present → consulted, not blocked", async () => {
    const wt = cycleWorktree(2);
    const rt = tmp("rt");
    mkdirSync(join(rt, "peer"), { recursive: true });
    writeFileSync(join(rt, "peer", "cycle-h-3.json"), "{}\n");
    const { alerts, s } = sinks();
    const r = await runPeerGate(wt, rt, "h-3", "hard", s, { heteroAvailable: true });
    expect(r.verdict).toBe("consulted");
    expect(r.blocked).toBe(false);
    expect(alerts).toHaveLength(0);
  });

  it("heteroAvailable=false + self-reviewed → self-review-allowed: RECORDED, never blocked", async () => {
    // AC4: single-agent / single-vendor → self-review is an allowed fallback. It
    // is recorded (alert + event with a reason) but the gate NEVER blocks.
    const wt = cycleWorktree(5); // even a high-complexity delivery is allowed
    const rt = tmp("rt");
    const { alerts, events, s } = sinks();
    const r = await runPeerGate(wt, rt, "h-4", "hard", s, { heteroAvailable: false });
    expect(r.verdict).toBe("self-review-allowed");
    expect(r.blocked).toBe(false);
    expect(r.heteroAvailable).toBe(false);
    expect(r.reasons[0]).toContain("self_review_fallback");
    expect(alerts[0]).toContain("self-review fallback");
    expect(alerts[0]).toContain("not blocked");
    expect(events[0]?.verdict).toBe("self-review-allowed");
  });

  it("heteroAvailable=false + peer evidence present → consulted (a peer ran anyway)", async () => {
    const wt = cycleWorktree(2);
    const rt = tmp("rt");
    mkdirSync(join(rt, "peer"), { recursive: true });
    writeFileSync(join(rt, "peer", "cycle-h-5.md"), "AGREE\n");
    const { s } = sinks();
    const r = await runPeerGate(wt, rt, "h-5", "hard", s, { heteroAvailable: false });
    expect(r.verdict).toBe("consulted");
    expect(r.blocked).toBe(false);
  });

  it("empty delivery → not-required regardless of heteroAvailable", async () => {
    const wt = cycleWorktree(0);
    const { events, s } = sinks();
    const rOn = await runPeerGate(wt, tmp("rt"), "h-6a", "hard", s, { heteroAvailable: true });
    const rOff = await runPeerGate(wt, tmp("rt"), "h-6b", "hard", s, { heteroAvailable: false });
    expect(rOn.verdict).toBe("not-required");
    expect(rOff.verdict).toBe("not-required");
    expect(rOn.blocked).toBe(false);
    expect(rOff.blocked).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("heteroAvailable omitted → legacy complexity-only behaviour is unchanged", async () => {
    // Back-compat: callers/tests that don't pass availability keep the FIX-293
    // contract (high-complexity + no evidence ⇒ block; small ⇒ not-required).
    const wtSmall = cycleWorktree(1);
    const wtBig = cycleWorktree(5);
    const { s } = sinks();
    expect((await runPeerGate(wtSmall, tmp("rt"), "h-7a", "hard", s)).verdict).toBe("not-required");
    expect((await runPeerGate(wtBig, tmp("rt"), "h-7b", "hard", s)).blocked).toBe(true);
  });

  it("heteroAvailable=true + soft mode → recorded skipped but NOT blocked (migration window honoured)", async () => {
    const wt = cycleWorktree(1);
    const { s } = sinks();
    const r = await runPeerGate(wt, tmp("rt"), "h-8", "soft", s, { heteroAvailable: true });
    expect(r.verdict).toBe("skipped");
    expect(r.blocked).toBe(false);
  });
});

describe("readPeerGateMode (FIX-293 AC-H4 policy flag)", () => {
  function repoWithPolicy(body: string | null): string {
    const repo = tmp("policy");
    mkdirSync(join(repo, ".roll"), { recursive: true });
    if (body !== null) writeFileSync(join(repo, ".roll", "policy.yaml"), body, "utf8");
    return repo;
  }

  it("absent policy.yaml → hard (the owner default)", () => {
    expect(readPeerGateMode(repoWithPolicy(null))).toBe("hard");
  });

  it("policy with no peer_gate key → hard (default)", () => {
    expect(readPeerGateMode(repoWithPolicy("loop_safety:\n  max_consecutive_failures: 3\n"))).toBe("hard");
  });

  it("loop_safety.peer_gate: soft → soft (explicit opt-out)", () => {
    expect(readPeerGateMode(repoWithPolicy("loop_safety:\n  peer_gate: soft\n"))).toBe("soft");
  });

  it("loop_safety.peer_gate: hard → hard", () => {
    expect(readPeerGateMode(repoWithPolicy("loop_safety:\n  peer_gate: hard\n"))).toBe("hard");
  });

  it("unreadable repo → hard (fail closed)", () => {
    expect(readPeerGateMode("/nonexistent/repo/path")).toBe("hard");
  });

  it("the soft-toggle round-trips through the evidence flow: soft no-block, hard block", async () => {
    const wt = cycleWorktree(5);
    const rt = tmp("rt");
    const hardRepo = repoWithPolicy(null);
    const softRepo = repoWithPolicy("loop_safety:\n  peer_gate: soft\n");
    const { s: hs } = sinks();
    const { s: ss } = sinks();
    expect((await runPeerGate(wt, rt, "tg-h", readPeerGateMode(hardRepo), hs)).blocked).toBe(true);
    expect(existsSync(join(rt, "peer"))).toBe(false); // no evidence written by the gate itself
    expect((await runPeerGate(wt, rt, "tg-s", readPeerGateMode(softRepo), ss)).blocked).toBe(false);
  });
});
