/**
 * US-PAIR-003 — pairing runtime gate. Injected reviewPeer/changedFiles/diff so
 * no real agent is spawned: asserts selection, evidence, events, non-blocking
 * timeout, fail-loud none-available, and file-absent = off.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enabledPairingStages, runPairing, type PairEvent, type RunPairingDeps } from "../src/runner/pairing-gate.js";

function project(yaml: string | null): { dir: string; rt: string } {
  const dir = mkdtempSync(join(tmpdir(), "roll-pair-"));
  mkdirSync(join(dir, ".roll"), { recursive: true });
  if (yaml !== null) writeFileSync(join(dir, ".roll", "pairing.yaml"), yaml);
  const rt = join(dir, "rt");
  mkdirSync(rt, { recursive: true });
  return { dir, rt };
}

const ENABLED = `enabled: true\nstages: [code]\ncapability:\n  claude: [code]\n  codex: [code]\n  kimi: [code]\n`;
// US-PAIR-004: a config that enables every stage and declares each agent
// capable across them, so stage plumbing can be exercised independently.
const ALL_STAGES = `enabled: true\nstages: [design, test, code, cycle]\ncapability:\n  claude: [design, test, code, cycle]\n  codex: [design, test, code, cycle]\n  kimi: [design, test, code, cycle]\n`;
const highComplexity = async (): Promise<string[]> => ["a.ts", "b.ts", "c.ts", "d.ts"]; // >3 → high

function deps(over: Partial<RunPairingDeps> = {}): { d: RunPairingDeps; events: PairEvent[] } {
  const events: PairEvent[] = [];
  const d: RunPairingDeps = {
    installed: ["claude", "codex", "kimi"],
    isAvailable: () => true,
    reviewPeer: async (_peer, _diff, _t) => ({ verdict: "refine", findings: ["x", "y"], cost: 0.12 }),
    changedFiles: highComplexity,
    diff: async () => "diff --git a/a.ts ...",
    event: (e) => events.push(e),
    now: () => 1234,
    ...over,
  };
  return { d, events };
}

describe("runPairing — US-PAIR-003", () => {
  it("file absent = off (never silent magic)", async () => {
    const { dir, rt } = project(null);
    const { d } = deps();
    expect((await runPairing(dir, dir, rt, "c1", "claude", "code", d)).status).toBe("off");
  });

  it("disabled config = off", async () => {
    const { dir, rt } = project(`enabled: false\nstages: [code]\n`);
    const { d } = deps();
    expect((await runPairing(dir, dir, rt, "c1", "claude", "code", d)).status).toBe("off");
  });

  it("low-complexity delivery = not-required (no peer burned)", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps({ changedFiles: async () => ["only.ts"] });
    expect((await runPairing(dir, dir, rt, "c1", "claude", "code", d)).status).toBe("not-required");
    expect(events).toHaveLength(0);
  });

  it("selects a heterogeneous peer, writes evidence, emits selected+verdict with cost", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps();
    const res = await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    expect(res.status).toBe("reviewed");
    expect(res.peer).not.toBe("claude"); // heterogeneous
    // evidence written to the peer-gate contract path
    const ev = JSON.parse(readFileSync(join(rt, "peer", "cycle-c1.pair.json"), "utf8"));
    expect(ev.peer).toBe(res.peer);
    expect(ev.verdict).toBe("refine");
    // FIX-335 parallel: every candidate emits a selected (fired concurrently);
    // exactly ONE verdict — the winner's — and it comes after the selecteds.
    const selecteds = events.filter((e) => e.type === "pair:selected");
    const verdicts = events.filter((e) => e.type === "pair:verdict") as Extract<PairEvent, { type: "pair:verdict" }>[];
    expect(selecteds.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.type === "pair:selected" || e.type === "pair:verdict")).toBe(true);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.peer).toBe(res.peer);
    expect(verdicts[0]?.findings).toBe(2);
    expect(verdicts[0]?.cost).toBe(0.12);
    // the lone verdict is emitted only after a peer was selected.
    expect(events.indexOf(verdicts[0]!)).toBeGreaterThan(events.indexOf(selecteds[0]!));
  });

  it("empty diff = not-required, no peer burned, no selected event (pi pair-review)", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps({ diff: async () => "   \n" });
    const res = await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    expect(res.status).toBe("not-required");
    expect(events).toHaveLength(0);
  });

  it("fail-loud none-available when no qualified heterogeneous peer", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps({ installed: ["claude"], isAvailable: () => true });
    const res = await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    expect(res.status).toBe("none-available");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pair:none-available");
  });

  it("non-blocking: reviewPeer timeout (null) for the WHOLE pool → status timeout, no verdict event, no throw", async () => {
    const { dir, rt } = project(ENABLED);
    // FIX-335: every candidate is fired in parallel (one pair:selected each); the
    // whole pool returning null yields status timeout with NO verdict + no evidence.
    const { d, events } = deps({ reviewPeer: async () => null });
    const res = await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    expect(res.status).toBe("timeout");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.type === "pair:selected")).toBe(true); // selected per candidate
    expect(events.some((e) => e.type === "pair:verdict")).toBe(false); // never a verdict
    expect(existsSync(join(rt, "peer", "cycle-c1.pair.json"))).toBe(false);
  });

  it("FIX-335 parallel take-first: a null peer is skipped, the non-null peer wins, evidence/verdict are the winner's", async () => {
    const { dir, rt } = project(ENABLED);
    // Two heterogeneous candidates are fired concurrently: "codex" flakes (null),
    // "kimi" returns a real verdict. The winner must be the non-null peer, with a
    // single verdict + evidence recording that peer — regardless of dispatch order.
    const { d, events } = deps({
      reviewPeer: async (peer) =>
        peer === "kimi" ? { verdict: "agree", findings: ["ok"], cost: 0.1 } : null,
    });
    const res = await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    expect(res.status).toBe("reviewed");
    expect(res.peer).toBe("kimi"); // the non-null peer won, not the flaky one
    expect(res.verdict).toBe("agree");
    // every candidate emitted a selected (parallel dispatch); exactly one verdict.
    const selecteds = events.filter((e) => e.type === "pair:selected") as Extract<PairEvent, { type: "pair:selected" }>[];
    expect(selecteds.length).toBeGreaterThanOrEqual(2);
    expect(selecteds.some((e) => e.peer === "kimi")).toBe(true);
    const verdicts = events.filter((e) => e.type === "pair:verdict") as Extract<PairEvent, { type: "pair:verdict" }>[];
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.peer).toBe("kimi");
    // evidence is the winner's only — the flaky peer never wrote anything.
    const ev = JSON.parse(readFileSync(join(rt, "peer", "cycle-c1.pair.json"), "utf8"));
    expect(ev.peer).toBe("kimi");
    expect(ev.verdict).toBe("agree");
  });

  it("FIX-335: the FIRST non-null result wins (a slow null does not beat a faster real verdict)", async () => {
    const { dir, rt } = project(ENABLED);
    // "codex" returns null quickly; "kimi" returns a real verdict a tick later.
    // take-first must wait past the fast null and use the real verdict, never
    // resolving null while a valid result is still in flight.
    const { d, events } = deps({
      reviewPeer: async (peer) => {
        if (peer === "kimi") {
          await new Promise((r) => setTimeout(r, 10));
          return { verdict: "refine", findings: ["a", "b"], cost: 0.2 };
        }
        return null; // fast null
      },
    });
    const res = await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    expect(res.status).toBe("reviewed");
    expect(res.peer).toBe("kimi");
    const verdicts = events.filter((e) => e.type === "pair:verdict") as Extract<PairEvent, { type: "pair:verdict" }>[];
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.findings).toBe(2);
  });

  it("never throws: a broken reviewPeer yields status error, not an exception", async () => {
    const { dir, rt } = project(ENABLED);
    const { d } = deps({
      reviewPeer: async () => {
        throw new Error("boom");
      },
    });
    await expect(runPairing(dir, dir, rt, "c1", "claude", "code", d)).resolves.toEqual({ status: "error" });
  });
});

describe("runPairing — US-PAIR-004 multi-stage triggering", () => {
  it("a stage NOT listed in pairing.yaml stages = off (independent opt-out)", async () => {
    // only `code` enabled → asking for `design` is off, even though every agent
    // is declared design-capable in capability.
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps();
    expect((await runPairing(dir, dir, rt, "c1", "claude", "design", d)).status).toBe("off");
    expect(events).toHaveLength(0);
  });

  it("design stage runs when enabled (stage is a real parameter, not hardcoded code)", async () => {
    const { dir, rt } = project(ALL_STAGES);
    const { d, events } = deps();
    const res = await runPairing(dir, dir, rt, "c1", "claude", "design", d);
    expect(res.status).toBe("reviewed");
    // the selected event carries the stage that fired
    const sel = events.find((e) => e.type === "pair:selected") as Extract<PairEvent, { type: "pair:selected" }>;
    expect(sel.stage).toBe("design");
    // the verdict event also carries the stage (US-PAIR-004: distinguishable per stage)
    const verdict = events.find((e) => e.type === "pair:verdict") as Extract<PairEvent, { type: "pair:verdict" }> & { stage?: string };
    expect(verdict.stage).toBe("design");
  });

  it("each enabled stage writes its OWN evidence file (no cross-stage overwrite)", async () => {
    const { dir, rt } = project(ALL_STAGES);
    const { d } = deps();
    await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    await runPairing(dir, dir, rt, "c1", "claude", "design", d);
    await runPairing(dir, dir, rt, "c1", "claude", "cycle", d);
    // code keeps the legacy PAIR-003 contract path (back-compat)
    const code = JSON.parse(readFileSync(join(rt, "peer", "cycle-c1.pair.json"), "utf8"));
    expect(code.stage).toBe("code");
    // other stages are namespaced so they don't clobber each other or code
    const design = JSON.parse(readFileSync(join(rt, "peer", "cycle-c1.design.pair.json"), "utf8"));
    expect(design.stage).toBe("design");
    const cycle = JSON.parse(readFileSync(join(rt, "peer", "cycle-c1.cycle.pair.json"), "utf8"));
    expect(cycle.stage).toBe("cycle");
  });

  it("none-available is fail-loud per stage (event carries the firing stage)", async () => {
    const { dir, rt } = project(ALL_STAGES);
    const { d, events } = deps({ installed: ["claude"] });
    const res = await runPairing(dir, dir, rt, "c1", "claude", "test", d);
    expect(res.status).toBe("none-available");
    const none = events[0] as Extract<PairEvent, { type: "pair:none-available" }>;
    expect(none.stage).toBe("test");
  });

  it("PAIR-003 safety invariants hold for every stage: timeout is non-blocking, never throws", async () => {
    const { dir, rt } = project(ALL_STAGES);
    const { d: dTimeout } = deps({ reviewPeer: async () => null });
    expect((await runPairing(dir, dir, rt, "c1", "claude", "cycle", dTimeout)).status).toBe("timeout");
    const { d: dThrow } = deps({
      reviewPeer: async () => {
        throw new Error("boom");
      },
    });
    await expect(runPairing(dir, dir, rt, "c1", "claude", "test", dThrow)).resolves.toEqual({ status: "error" });
  });
});

describe("enabledPairingStages — executor stage iteration seam (US-PAIR-004)", () => {
  it("file absent = no stages (pairing off, never silent magic)", () => {
    const { dir } = project(null);
    expect(enabledPairingStages(dir)).toEqual([]);
  });

  it("disabled config = no stages even if stages are listed", () => {
    const { dir } = project(`enabled: false\nstages: [design, code]\n`);
    expect(enabledPairingStages(dir)).toEqual([]);
  });

  it("returns exactly the enabled stages, preserving config order (default = code only)", () => {
    const { dir } = project(ENABLED);
    expect(enabledPairingStages(dir)).toEqual(["code"]);
  });

  it("multi-stage config returns every enabled stage to iterate", () => {
    const { dir } = project(ALL_STAGES);
    expect(enabledPairingStages(dir)).toEqual(["design", "test", "code", "cycle"]);
  });

  it("a malformed config never throws — degrades to no stages (non-blocking)", () => {
    const { dir } = project(`enabled: true\nstages: [bogus-stage]\n`);
    expect(enabledPairingStages(dir)).toEqual([]);
  });

  // kimi pair-review (US-PAIR-004): a duplicate stage in pairing.yaml must not
  // fire pairing twice — that would burn two peers, emit duplicate events, and
  // (for `code`) write the legacy evidence path twice. De-dupe, keep first-seen order.
  it("de-dupes repeated stages so each enabled stage fires at most once", () => {
    const { dir } = project(`enabled: true\nstages: [code, code, design, code]\n`);
    expect(enabledPairingStages(dir)).toEqual(["code", "design"]);
  });
});

// ── US-PAIR-009: score stage — heterogeneous peer scores the cycle ───────────
import { parsePairScoreOutput, runScorePairing, type RunScorePairingDeps } from "../src/runner/pairing-gate.js";
import { readStorySelfScores } from "../src/lib/self-score.js";

const SCORE_CFG = `enabled: true\nstages: [code, score]\ncapability:\n  claude: [code, score]\n  codex: [code, score]\n  kimi: [code, score]\n`;

function scoreDeps(over: Partial<RunScorePairingDeps> = {}): { d: RunScorePairingDeps; events: PairEvent[] } {
  const events: PairEvent[] = [];
  const d: RunScorePairingDeps = {
    installed: ["claude", "codex", "kimi"],
    isAvailable: () => true,
    scorePeer: async () => ({ score: 8, verdict: "good", rationale: "clean delivery, tests cover the seams", cost: 0.05 }),
    event: (e) => events.push(e),
    now: () => 1234,
    ...over,
  };
  return { d, events };
}

describe("runScorePairing — US-PAIR-009", () => {
  it("file absent / stage not enabled = off", async () => {
    const off = project(null);
    const { d } = scoreDeps();
    expect((await runScorePairing(off.dir, off.rt, "c1", "claude", "US-X-001", "roll-build", "summary", d)).status).toBe("off");
    const noScore = project(ENABLED); // stages: [code] only
    expect((await runScorePairing(noScore.dir, noScore.rt, "c1", "claude", "US-X-001", "roll-build", "summary", scoreDeps().d)).status).toBe("off");
  });

  it("scores via a heterogeneous peer: note + evidence + pair:score event", async () => {
    const { dir, rt } = project(SCORE_CFG);
    const { d, events } = scoreDeps();
    const r = await runScorePairing(dir, rt, "c1", "claude", "US-X-001", "roll-build", "delivery summary", d);
    expect(r.status).toBe("scored");
    expect(r.peer).not.toBe("claude");
    // note: written with pair provenance, readable by existing readers
    const notes = readStorySelfScores(dir, "US-X-001");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.score).toBe(8);
    const noteText = readFileSync(notes[0]?.sourcePath ?? "", "utf8");
    expect(noteText).toContain("scoring: pair");
    expect(noteText).toContain(`scored-by: ${r.peer}`);
    // evidence file in the stage namespace
    const ev = JSON.parse(readFileSync(join(rt, "peer", "cycle-c1.score.pair.json"), "utf8"));
    expect(ev.score).toBe(8);
    expect(ev.stage).toBe("score");
    // FIX-335 parallel: each candidate emits a selected (fired concurrently);
    // exactly ONE pair:score — the winner's.
    const selecteds = events.filter((e) => e.type === "pair:selected");
    const scoreEvents = events.filter((e) => e.type === "pair:score") as Extract<PairEvent, { type: "pair:score" }>[];
    expect(selecteds.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.type === "pair:selected" || e.type === "pair:score")).toBe(true);
    expect(scoreEvents).toHaveLength(1);
    expect(scoreEvents[0]?.score).toBe(8);
    expect(scoreEvents[0]?.cost).toBe(0.05);
  });

  it("FIX-335: one scorer flakes (null), the other scores → uses the real peer score (not self-score)", async () => {
    const { dir, rt } = project(SCORE_CFG);
    const tried: string[] = [];
    // Both hetero scorers fire in parallel: "codex" flakes (null), "kimi" returns a
    // real score → take-first must use the non-null peer, NOT fall back to self-score.
    const { d, events } = scoreDeps({
      installed: ["claude", "codex", "kimi"],
      scorePeer: async (peer: string) => {
        tried.push(peer);
        return peer === "kimi" ? { score: 7, verdict: "ok" as const, rationale: "the live peer scored", cost: 0.02 } : null;
      },
    });
    const r = await runScorePairing(dir, rt, "c1", "claude", "US-X-001", "roll-build", "s", d);
    expect(r.status).toBe("scored"); // a real peer score, NOT the self-score fallback
    expect(tried.length).toBeGreaterThanOrEqual(2); // both candidates were fired (parallel)
    expect(r.peer).toBe("kimi"); // the non-null scorer won
    expect(events.filter((e) => e.type === "pair:selected").length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === "pair:score")).toBe(true);
    expect(readStorySelfScores(dir, "US-X-001")[0]?.score).toBe(7); // recorded as a pair score
  });

  it("no heterogeneous candidate → none-available event, never blocks", async () => {
    const { dir, rt } = project(SCORE_CFG);
    const { d, events } = scoreDeps({ installed: ["claude"] });
    const r = await runScorePairing(dir, rt, "c1", "claude", "US-X-001", "roll-build", "s", d);
    expect(r.status).toBe("none-available");
    expect(events.map((e) => e.type)).toEqual(["pair:none-available"]);
    expect(readStorySelfScores(dir, "US-X-001")).toHaveLength(0); // fallback note is the caller's self path
  });

  it("peer timeout → status timeout, no note, no partial evidence", async () => {
    const { dir, rt } = project(SCORE_CFG);
    const { d } = scoreDeps({ scorePeer: async () => null });
    const r = await runScorePairing(dir, rt, "c1", "claude", "US-X-001", "roll-build", "s", d);
    expect(r.status).toBe("timeout");
    expect(existsSync(join(rt, "peer", "cycle-c1.score.pair.json"))).toBe(false);
    expect(readStorySelfScores(dir, "US-X-001")).toHaveLength(0);
  });

  it("out-of-range / malformed peer score → error status, nothing written", async () => {
    const { dir, rt } = project(SCORE_CFG);
    const { d } = scoreDeps({ scorePeer: async () => ({ score: 99, verdict: "good", rationale: "x", cost: 0 }) });
    const r = await runScorePairing(dir, rt, "c1", "claude", "US-X-001", "roll-build", "s", d);
    expect(r.status).toBe("error");
    expect(readStorySelfScores(dir, "US-X-001")).toHaveLength(0);
  });
});

describe("parsePairScoreOutput — US-PAIR-009", () => {
  it("parses SCORE/VERDICT/RATIONALE lines from peer stdout", () => {
    const out = parsePairScoreOutput("noise\nSCORE: 8\nVERDICT: good\nRATIONALE: tight TCR, ACs covered\nmore noise");
    expect(out).toEqual({ score: 8, verdict: "good", rationale: "tight TCR, ACs covered" });
  });
  it("rejects missing or malformed fields (caller falls back to self)", () => {
    expect(parsePairScoreOutput("VERDICT: good\nRATIONALE: x")).toBeNull(); // no score
    expect(parsePairScoreOutput("SCORE: eleven\nVERDICT: good\nRATIONALE: x")).toBeNull();
    expect(parsePairScoreOutput("SCORE: 12\nVERDICT: good\nRATIONALE: x")).toBeNull(); // out of range
    expect(parsePairScoreOutput("SCORE: 7\nVERDICT: great\nRATIONALE: x")).toBeNull(); // bad verdict
    expect(parsePairScoreOutput("SCORE: 7\nVERDICT: ok")).toBeNull(); // no rationale
  });
  it("is case/spacing tolerant", () => {
    expect(parsePairScoreOutput("score:9\nverdict:  OK\nrationale: fine")).toEqual({ score: 9, verdict: "ok", rationale: "fine" });
  });
});

describe("score never routes through the review loop (kimi pair-review)", () => {
  it("enabledPairingStages filters score out", () => {
    const { dir } = project(SCORE_CFG);
    expect(enabledPairingStages(dir)).toEqual(["code"]);
  });
  it("runPairing early-offs on score (belt-and-braces)", async () => {
    const { dir, rt } = project(SCORE_CFG);
    const { d, events } = deps();
    expect((await runPairing(dir, dir, rt, "c1", "claude", "score", d)).status).toBe("off");
    expect(events).toHaveLength(0);
  });
});

// ── FIX-293: the peer-gate retry consult ─────────────────────────────────────
import { retryPeerConsult, type RetryPeerConsultDeps } from "../src/runner/pairing-gate.js";

function retryDeps(over: Partial<RetryPeerConsultDeps> = {}): { d: RetryPeerConsultDeps; events: PairEvent[] } {
  const events: PairEvent[] = [];
  const d: RetryPeerConsultDeps = {
    installed: ["claude", "codex"], // codex is heterogeneous from claude
    workingAgent: "claude",
    reviewPeer: async (_peer, _diff, _t) => ({ verdict: "agree", findings: [], cost: 0.05 }),
    diff: async () => "diff --git a/a.ts ...",
    event: (e) => events.push(e),
    now: () => 7777,
    ...over,
  };
  return { d, events };
}

describe("retryPeerConsult — FIX-293 AC-H3 (bounded retry, config-independent)", () => {
  it("fires WITHOUT pairing.yaml (always-on gate, not opt-in) and writes the gate's evidence file", async () => {
    const { rt } = project(null); // no pairing.yaml — the gate retry still runs
    const wt = rt; // diff is injected, so worktree path is irrelevant here
    const { d, events } = retryDeps();
    const r = await retryPeerConsult(wt, rt, "c-retry", d);
    expect(r.status).toBe("reviewed");
    expect(r.peer).toBe("codex");
    // The evidence file is the canonical peer-gate path → peerEvidencePresent flips true.
    expect(existsSync(join(rt, "peer", "cycle-c-retry.pair.json"))).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["pair:selected", "pair:verdict"]);
  });

  it("a flaky/timed-out peer (reviewPeer→null) stays blocked, no evidence, no death-spiral", async () => {
    const { rt } = project(null);
    const { d } = retryDeps({ reviewPeer: async () => null });
    const r = await retryPeerConsult(rt, rt, "c-to", d);
    expect(r.status).toBe("timeout");
    expect(existsSync(join(rt, "peer", "cycle-c-to.pair.json"))).toBe(false);
  });

  it("empty diff → nothing to review (no peer burned)", async () => {
    const { rt } = project(null);
    const { d } = retryDeps({ diff: async () => "   " });
    const r = await retryPeerConsult(rt, rt, "c-empty", d);
    expect(r.status).toBe("empty");
  });

  it("respects the injected timeout (it is what bounds the consult)", async () => {
    const { rt } = project(null);
    let seenTimeout = -1;
    const { d } = retryDeps({ timeoutMs: 12345, reviewPeer: async (_p, _d, t) => { seenTimeout = t; return { verdict: "agree", findings: [], cost: 0 }; } });
    await retryPeerConsult(rt, rt, "c-t", d);
    expect(seenTimeout).toBe(12345);
  });
});

describe("retryPeerConsult — FIX-293 follow-up: same-type SEPARATE-SESSION fallback", () => {
  // (a) Single coding-agent-type env: only the working agent is installed. The
  // retry must NOT report none-available — it falls back to a fresh instance of
  // the working agent's OWN type (spawned via reviewPeer = a separate session),
  // produces evidence, and is NOT blocked. The over-blocking #711 bug is gone.
  it("single-agent-type env → falls back to a same-type separate-session peer, reviewed (not blocked)", async () => {
    const { rt } = project(null);
    const spawnedPeers: string[] = [];
    const { d, events } = retryDeps({
      installed: ["claude"], // only the working agent's type is installed
      workingAgent: "claude",
      reviewPeer: async (peer) => { spawnedPeers.push(peer); return { verdict: "agree", findings: [], cost: 0.03 }; },
    });
    const r = await retryPeerConsult(rt, rt, "c-same", d);
    expect(r.status).toBe("reviewed");
    expect(r.peer).toBe("claude"); // the reviewer is a fresh claude instance
    expect(r.sameTypeFallback).toBe(true);
    // reviewPeer (which spawns a distinct subprocess) WAS invoked → separate session.
    expect(spawnedPeers).toEqual(["claude"]);
    // Evidence is written → the gate re-runs green and the cycle is NOT blocked.
    expect(existsSync(join(rt, "peer", "cycle-c-same.pair.json"))).toBe(true);
    const ev = JSON.parse(readFileSync(join(rt, "peer", "cycle-c-same.pair.json"), "utf8")) as { peer: string; sameTypeFallback: boolean };
    expect(ev.peer).toBe("claude");
    expect(ev.sameTypeFallback).toBe(true);
    const selected = events.find((e) => e.type === "pair:selected") as Extract<PairEvent, { type: "pair:selected" }>;
    expect(selected.peer).toBe("claude");
    // No fail-loud none-available event — a peer WAS consulted.
    expect(events.some((e) => e.type === "pair:none-available")).toBe(false);
  });

  // (b) Heterogeneous is still PREFERRED when a different-vendor agent exists —
  // the same-type fallback is the LAST resort, not the default.
  it("heterogeneous peer still PREFERRED over the same-type fallback", async () => {
    const { rt } = project(null);
    const { d } = retryDeps({ installed: ["claude", "codex"], workingAgent: "claude" });
    const r = await retryPeerConsult(rt, rt, "c-het", d);
    expect(r.status).toBe("reviewed");
    expect(r.peer).toBe("codex"); // different vendor wins
    expect(r.sameTypeFallback).toBe(false);
  });

  // (c) The cycle STILL BLOCKS when the separate-session consult yields no
  // evidence (timeout/failure) — even via the same-type fallback. Block now means
  // "the separate-session review produced no evidence", not "no other agent".
  it("same-type fallback that times out → still blocked (timeout), no evidence", async () => {
    const { rt } = project(null);
    const { d } = retryDeps({ installed: ["claude"], workingAgent: "claude", reviewPeer: async () => null });
    const r = await retryPeerConsult(rt, rt, "c-same-to", d);
    expect(r.status).toBe("timeout");
    expect(r.sameTypeFallback).toBe(true);
    expect(existsSync(join(rt, "peer", "cycle-c-same-to.pair.json"))).toBe(false);
  });

  // (c2) FIX-331 + codex peer-review: when heterogeneous peers EXIST but ALL fail
  // (timeout/null), the retry STAYS BLOCKED — it must NOT degrade to a same-type
  // review even though the working agent's own type could produce a verdict. A
  // wholly-failing hetero pool blocking is FIX-293's hard gate; same-type is ONLY
  // for the zero-hetero (single-vendor) env.
  it("hetero peers all fail → blocked (timeout), never falls back to same-type while hetero exists", async () => {
    const { rt } = project(null);
    const spawned: string[] = [];
    const { d } = retryDeps({
      installed: ["claude", "codex"], // codex is heterogeneous from claude
      workingAgent: "claude",
      // hetero (codex) fails; the working agent's own type (claude) WOULD pass —
      // but it must never be reached while a hetero peer was available.
      reviewPeer: async (peer) => {
        spawned.push(peer);
        return peer === "claude" ? { verdict: "agree", findings: [], cost: 0 } : null;
      },
    });
    const r = await retryPeerConsult(rt, rt, "c-hetero-allfail", d);
    expect(r.status).toBe("timeout"); // blocked, NOT reviewed via same-type
    expect(r.sameTypeFallback).toBe(false); // the failing peer was the hetero codex
    expect(spawned).toEqual(["codex"]); // same-type claude was NEVER attempted
    expect(existsSync(join(rt, "peer", "cycle-c-hetero-allfail.pair.json"))).toBe(false);
  });

  // (d) THE RED LINE: the reviewer is always reached through reviewPeer, which
  // spawns a DISTINCT process — even when the peer type equals the working type,
  // it is a separate session, never the builder scoring its own work in-session.
  // Here reviewPeer asserts it received a peer name to spawn (a separate session);
  // an in-session self-score path would never invoke reviewPeer at all.
  it("RED LINE — same-type peer is reached via reviewPeer (separate spawn), never in-session self-review", async () => {
    const { rt } = project(null);
    let reviewPeerInvoked = false;
    const { d } = retryDeps({
      installed: ["claude"],
      workingAgent: "claude",
      reviewPeer: async (peer) => {
        reviewPeerInvoked = true;
        // The reviewer is invoked as a spawned peer with a name, not the builder's
        // own live session producing a self-verdict.
        expect(peer).toBe("claude");
        return { verdict: "agree", findings: [], cost: 0 };
      },
    });
    await retryPeerConsult(rt, rt, "c-redline", d);
    expect(reviewPeerInvoked).toBe(true);
  });

  // The only true none-available now: nothing to spawn at all (no installed agent
  // AND no working-agent name) — NOT "only one vendor installed".
  it("no agent at all (empty installed + empty workingAgent) → none-available (audited)", async () => {
    const { rt } = project(null);
    const { d, events } = retryDeps({ installed: [], workingAgent: "" });
    const r = await retryPeerConsult(rt, rt, "c-none", d);
    expect(r.status).toBe("none-available");
    const none = events.find((e) => e.type === "pair:none-available") as Extract<PairEvent, { type: "pair:none-available" }>;
    expect(none.reason).toContain("no peer could be consulted");
    expect(existsSync(join(rt, "peer", "cycle-c-none.pair.json"))).toBe(false);
  });
});
