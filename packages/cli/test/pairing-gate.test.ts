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
    // events: selected then verdict (with findings count + cost)
    expect(events.map((e) => e.type)).toEqual(["pair:selected", "pair:verdict"]);
    const verdict = events[1] as Extract<PairEvent, { type: "pair:verdict" }>;
    expect(verdict.findings).toBe(2);
    expect(verdict.cost).toBe(0.12);
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

  it("non-blocking: reviewPeer timeout (null) → status timeout, no verdict event, no throw", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps({ reviewPeer: async () => null });
    const res = await runPairing(dir, dir, rt, "c1", "claude", "code", d);
    expect(res.status).toBe("timeout");
    expect(events.map((e) => e.type)).toEqual(["pair:selected"]); // selected but no verdict
    expect(existsSync(join(rt, "peer", "cycle-c1.pair.json"))).toBe(false);
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
