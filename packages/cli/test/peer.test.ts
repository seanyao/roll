import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { peerCommand, runPeerReview, type PeerReviewDeps } from "../src/commands/peer.js";

function project(): string {
  return mkdtempSync(join(tmpdir(), "roll-peer-"));
}

function deps(over: Partial<PeerReviewDeps> = {}): PeerReviewDeps {
  let now = 1_000;
  return {
    installedReviewers: () => ["pi"],
    currentWorker: () => "kimi",
    nowMs: () => {
      now += 125;
      return now;
    },
    nowIso: () => "2026-06-11T15:00:00Z",
    spawnReviewer: async () => ({ status: "ok", stdout: "VERDICT: APPROVE\nREASON: ok\n" }),
    ...over,
  };
}

async function capture(fn: () => Promise<number> | number): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const ow = process.stdout.write.bind(process.stdout);
  const oe = process.stderr.write.bind(process.stderr);
  try {
    // @ts-expect-error test capture
    process.stdout.write = (s: string): boolean => ((out += String(s)), true);
    // @ts-expect-error test capture
    process.stderr.write = (s: string): boolean => ((err += String(s)), true);
    const code = await fn();
    return { code, out, err };
  } finally {
    process.stdout.write = ow;
    process.stderr.write = oe;
  }
}

describe("FIX-255 roll peer", () => {
  it("prints a TS-native one-shot review help surface", async () => {
    const r = await capture(() => peerCommand(["--help"], deps()));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: roll peer");
    expect(r.out).toContain("--reviewer <agent>");
    expect(r.out).toContain("--prompt <text>");
  });

  it("fails loudly when an option is missing its value", async () => {
    const r = await capture(() => peerCommand(["--reviewer", "--prompt", "review"], deps()));

    expect(r.code).toBe(1);
    expect(r.err).toContain("roll peer: --reviewer requires a value");
  });

  it("records structured facts for unavailable reviewers without spawning", async () => {
    const p = project();
    const facts = await runPeerReview(
      { projectPath: p, prompt: "review", mode: "hetero", workerAgents: ["claude"], timeoutMs: 1_000 },
      deps({ installedReviewers: () => [], spawnReviewer: async () => ({ status: "error", reason: "should_not_spawn", stdout: "" }) }),
    );

    expect(facts.verdict).toBe("ERROR");
    expect(facts.reason).toBe("no_installed_reviewer");
    const runs = readFileSync(join(p, ".roll", "peer", "runs.jsonl"), "utf8");
    expect(runs).toContain('"verdict":"ERROR"');
    expect(runs).toContain('"durationMs"');
  });

  it("records timeout, command family, duration, and transcript reference", async () => {
    const p = project();
    const facts = await runPeerReview(
      { projectPath: p, prompt: "review", reviewer: "pi", mode: "self", workerAgents: ["kimi"], timeoutMs: 50 },
      deps({ spawnReviewer: async () => ({ status: "timeout", stdout: "FINDING: partial output\n" }) }),
    );

    expect(facts.verdict).toBe("TIMEOUT");
    expect(facts.commandFamily).toBe("pi");
    expect(facts.durationMs).toBe(125);
    expect(facts.transcriptPath).toBeDefined();
    expect(existsSync(facts.transcriptPath ?? "")).toBe(true);
  });

  it("FIX-336: rotates to the next heterogeneous candidate when the first fails", async () => {
    const p = project();
    const calls: string[] = [];
    const facts = await runPeerReview(
      { projectPath: p, prompt: "review", mode: "auto", workerAgents: ["kimi"], timeoutMs: 1_000 },
      deps({
        installedReviewers: () => ["kimi", "pi", "reasonix"],
        currentWorker: () => "kimi",
        spawnReviewer: async ({ agent }) => {
          calls.push(agent);
          if (agent === "pi") return { status: "error", reason: "spawn_failed", stdout: "FINDING: flake\n" };
          return { status: "ok", stdout: "VERDICT: APPROVE\nREASON: good\n" };
        },
      }),
    );

    expect(calls).toEqual(["pi", "reasonix"]);
    expect(facts.verdict).toBe("APPROVE");
    expect(facts.agent).toBe("reasonix");
    const runs = readFileSync(join(p, ".roll", "peer", "runs.jsonl"), "utf8").trim().split("\n");
    expect(runs).toHaveLength(2);
    expect(runs[0]).toContain('"verdict":"ERROR"');
    expect(runs[0]).toContain('"agent":"pi"');
    expect(runs[1]).toContain('"verdict":"APPROVE"');
    expect(runs[1]).toContain('"agent":"reasonix"');
  });

  it("FIX-336: returns the last failure when every candidate fails", async () => {
    const p = project();
    const facts = await runPeerReview(
      { projectPath: p, prompt: "review", mode: "auto", workerAgents: ["kimi"], timeoutMs: 1_000 },
      deps({
        installedReviewers: () => ["kimi", "pi", "reasonix"],
        currentWorker: () => "kimi",
        spawnReviewer: async () => ({ status: "error", reason: "all_down", stdout: "" }),
      }),
    );

    expect(facts.verdict).toBe("ERROR");
    expect(facts.agent).toBe("kimi");
    const runs = readFileSync(join(p, ".roll", "peer", "runs.jsonl"), "utf8").trim().split("\n");
    expect(runs).toHaveLength(3);
  });

  it("FIX-336: auto degradation is recorded only after hetero peers fail", async () => {
    const p = project();
    const facts = await runPeerReview(
      { projectPath: p, prompt: "review", mode: "auto", workerAgents: ["kimi"], timeoutMs: 1_000 },
      deps({
        installedReviewers: () => ["kimi", "pi", "reasonix"],
        currentWorker: () => "kimi",
        spawnReviewer: async ({ agent }) => {
          if (agent === "kimi") return { status: "ok", stdout: "VERDICT: APPROVE\nREASON: self\n" };
          return { status: "error", reason: "down", stdout: "" };
        },
      }),
    );

    expect(facts.agent).toBe("kimi");
    expect(facts.effectiveMode).toBe("self");
    expect(facts.degradedReason).toBe("all_heterogeneous_peers_failed");
  });
});
