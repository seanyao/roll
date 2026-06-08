/**
 * US-PAIR-003 — pairing runtime gate. Injected reviewPeer/changedFiles/diff so
 * no real agent is spawned: asserts selection, evidence, events, non-blocking
 * timeout, fail-loud none-available, and file-absent = off.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPairing, type PairEvent, type RunPairingDeps } from "../src/runner/pairing-gate.js";

function project(yaml: string | null): { dir: string; rt: string } {
  const dir = mkdtempSync(join(tmpdir(), "roll-pair-"));
  mkdirSync(join(dir, ".roll"), { recursive: true });
  if (yaml !== null) writeFileSync(join(dir, ".roll", "pairing.yaml"), yaml);
  const rt = join(dir, "rt");
  mkdirSync(rt, { recursive: true });
  return { dir, rt };
}

const ENABLED = `enabled: true\nstages: [code]\ncapability:\n  claude: [code]\n  codex: [code]\n  kimi: [code]\n`;
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
    expect((await runPairing(dir, dir, rt, "c1", "claude", d)).status).toBe("off");
  });

  it("disabled config = off", async () => {
    const { dir, rt } = project(`enabled: false\nstages: [code]\n`);
    const { d } = deps();
    expect((await runPairing(dir, dir, rt, "c1", "claude", d)).status).toBe("off");
  });

  it("low-complexity delivery = not-required (no peer burned)", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps({ changedFiles: async () => ["only.ts"] });
    expect((await runPairing(dir, dir, rt, "c1", "claude", d)).status).toBe("not-required");
    expect(events).toHaveLength(0);
  });

  it("selects a heterogeneous peer, writes evidence, emits selected+verdict with cost", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps();
    const res = await runPairing(dir, dir, rt, "c1", "claude", d);
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
    const res = await runPairing(dir, dir, rt, "c1", "claude", d);
    expect(res.status).toBe("not-required");
    expect(events).toHaveLength(0);
  });

  it("fail-loud none-available when no qualified heterogeneous peer", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps({ installed: ["claude"], isAvailable: () => true });
    const res = await runPairing(dir, dir, rt, "c1", "claude", d);
    expect(res.status).toBe("none-available");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pair:none-available");
  });

  it("non-blocking: reviewPeer timeout (null) → status timeout, no verdict event, no throw", async () => {
    const { dir, rt } = project(ENABLED);
    const { d, events } = deps({ reviewPeer: async () => null });
    const res = await runPairing(dir, dir, rt, "c1", "claude", d);
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
    await expect(runPairing(dir, dir, rt, "c1", "claude", d)).resolves.toEqual({ status: "error" });
  });
});
