import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RouteDeps } from "@roll/core";
import { scheduleParallelCycles } from "@roll/core";
import {
  type AgentSpawn,
  type AgentSpawnResult,
  type Ports,
  type RunnerPaths,
  nodePorts,
  runCycleOnce,
} from "../src/runner/index.js";
import { quarantineMainCheckout, checkMainDirty } from "../src/runner/main-checkout-guard.js";
import { runAttestGate } from "../src/runner/attest-gate.js";
import { classifyFailure, recordRootCauseFailure } from "../src/runner/failure-attribution.js";
import { clearCardFailure, readSkipCards, recordCardFailure } from "../src/runner/skip-cards.js";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-qa016-${tag}-`)));
  dirs.push(d);
  return d;
}

const GIT_ID = ["-c", "user.email=t@t", "-c", "user.name=t"];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const BACKLOG = [
  "| ID | Description | Status |",
  "|----|-------------|--------|",
  "| US-RUN-001 | QA16 fixture story est_min:5 | 📋 Todo |",
  "",
].join("\n");

function writePeerScore(root: string, storyId: string, cycleId: string): void {
  const dir = join(root, ".roll", "features", "uncategorized", storyId, "notes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `2026-07-03-roll-build-${storyId}-score.md`),
    [
      "---",
      "skill: roll-build",
      `story: ${storyId}`,
      "score: 8",
      "verdict: good",
      "ts: 2026-07-03T00:00:00Z",
      "scoring: pair",
      "scored-by: pi",
      `session-id: ${cycleId}:score:pi:a1:1780000000`,
      "---",
      "",
      "Peer score for the QA16 fixture.",
    ].join("\n"),
    "utf8",
  );
}

function seedFeatureCard(root: string, storyId: string, cycleId = "c-fixture"): void {
  const storyDir = join(root, ".roll", "features", "uncategorized", storyId);
  mkdirSync(join(storyDir, "latest"), { recursive: true });
  mkdirSync(join(storyDir, "screenshots"), { recursive: true });
  writeFileSync(
    join(storyDir, "spec.md"),
    [
      "---",
      `id: ${storyId}`,
      "screenshot_exempt: QA fixture uses file evidence; no rendered UI surface",
      "---",
      `# ${storyId} — QA16 fixture`,
      "",
      "**AC:**",
      "- [ ] cycle delivers with evidence",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(storyDir, "screenshots", "proof.png"), "png\n", "utf8");
  writeFileSync(
    join(storyDir, "ac-map.json"),
    JSON.stringify([{ ac: `${storyId}:AC1`, status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/proof.png" }] }], null, 2) + "\n",
    "utf8",
  );
  writeFileSync(join(storyDir, "latest", `${storyId}-report.html`), `<html><body>${storyId} report</body></html>\n`, "utf8");
  writePeerScore(root, storyId, cycleId);
}

function makeFixture(tag: string, cycleId = "c-fixture"): { repo: string; remote: string } {
  const remote = tmp(`${tag}-remote`);
  git(remote, ["init", "-q", "--bare", "-b", "main"]);

  const seed = tmp(`${tag}-seed`);
  git(seed, ["clone", "-q", remote, "."]);
  writeFileSync(join(seed, "app.txt"), "base\n", "utf8");
  mkdirSync(join(seed, ".roll"), { recursive: true });
  writeFileSync(join(seed, ".roll", "backlog.md"), BACKLOG, "utf8");
  seedFeatureCard(seed, "US-RUN-001", cycleId);
  git(seed, [...GIT_ID, "add", "-A"]);
  git(seed, [...GIT_ID, "commit", "-q", "-m", "seed qa16 fixture"]);
  git(seed, ["push", "-q", "origin", "main"]);

  const repo = tmp(`${tag}-repo`);
  git(repo, ["clone", "-q", remote, "."]);
  git(repo, ["fetch", "-q", "origin"]);
  return { repo, remote };
}

function paths(rt: string, cycleId: string): RunnerPaths {
  return {
    eventsPath: join(rt, "events.ndjson"),
    runsPath: join(rt, "runs.jsonl"),
    alertsPath: join(rt, "alerts.log"),
    lockPath: join(rt, "inner.lock"),
    heartbeatPath: join(rt, "heartbeat"),
    worktreePath: join(rt, "worktrees", `cycle-${cycleId}`),
  };
}

const routeDeps: RouteDeps = {
  readSlot: () => "claude-stream",
  firstInstalled: () => "claude-stream",
};

const CLAUDE_STREAM_JSON = [
  JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 5 } } }),
  JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.01, duration_ms: 1000 }),
].join("\n");

const shimAgentTcr: AgentSpawn = async (_agent, opts): Promise<AgentSpawnResult> => {
  const storyId = opts.storyId ?? "US-RUN-001";
  writePeerScore(opts.cwd, storyId, opts.cycleId);
  writeFileSync(join(opts.cwd, "delivered.txt"), `delivered ${storyId}\n`, "utf8");
  git(opts.cwd, [...GIT_ID, "add", "-A"]);
  git(opts.cwd, [...GIT_ID, "commit", "-q", "--no-verify", "-m", `tcr: deliver ${storyId}`]);
  return { stdout: CLAUDE_STREAM_JSON, stderr: "", exitCode: 0, timedOut: false };
};

function fakeGithub(status: 0 | 1 | 2, prState = "MERGED"): Ports["github"] {
  return {
    async repoSlug() {
      return "fixture/qa16";
    },
    async runPublishPlan() {
      return { status, prUrl: status === 0 ? "https://example.test/pr/16" : "", ok: status === 0 };
    },
    async prState() {
      return prState;
    },
    async prMergeInfo() {
      return prState === "MERGED"
        ? { state: "MERGED", mergedAt: "2026-07-03T00:00:00Z", mergeCommit: "abc123def456" }
        : { state: prState };
    },
    async openPrTitles() {
      return [];
    },
  };
}

async function runFixtureCycle(tag: string, cycleId: string): Promise<{ repo: string; result: Awaited<ReturnType<typeof runCycleOnce>> }> {
  const { repo } = makeFixture(tag, cycleId);
  const rt = tmp(`${tag}-rt`);
  const p = paths(rt, cycleId);
  const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
  const ports: Ports = { ...base, agentSpawn: shimAgentTcr, github: fakeGithub(0) };
  const result = await runCycleOnce({ ports, ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never } });
  return { repo, result };
}

function attestSinks(): {
  alerts: string[];
  events: Array<{ cycleId: string; verdict: string; reasons: string[] }>;
  s: { alert: (m: string) => void; event: (p: { cycleId: string; verdict: "produced" | "skipped"; reasons: string[] }) => void };
} {
  const alerts: string[] = [];
  const events: Array<{ cycleId: string; verdict: string; reasons: string[] }> = [];
  return { alerts, events, s: { alert: (m) => alerts.push(m), event: (p) => events.push(p) } };
}

function writeAttestCard(root: string, storyId: string, acMap: unknown, cycleId: string): void {
  const storyDir = join(root, ".roll", "features", "uncategorized", storyId);
  const latest = join(storyDir, "latest");
  mkdirSync(latest, { recursive: true });
  writeFileSync(
    join(storyDir, "spec.md"),
    [
      "---",
      `id: ${storyId}`,
      "screenshot_exempt: QA fixture uses file evidence; no rendered UI surface",
      "---",
      `# ${storyId}`,
      "",
      "**AC:**",
      "- [ ] evidence gate reacts",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(storyDir, "ac-map.json"), JSON.stringify(acMap, null, 2) + "\n", "utf8");
  for (const entry of Array.isArray(acMap) ? acMap : []) {
    const evidence = typeof entry === "object" && entry !== null ? (entry as { evidence?: unknown }).evidence : undefined;
    if (!Array.isArray(evidence)) continue;
    for (const ev of evidence) {
      const ref = typeof ev === "object" && ev !== null ? ((ev as { href?: unknown; textFile?: unknown }).href ?? (ev as { textFile?: unknown }).textFile) : undefined;
      if (typeof ref !== "string" || ref.includes("missing")) continue;
      const target = join(storyDir, ref);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "evidence\n", "utf8");
    }
  }
  writeFileSync(join(latest, `${storyId}-report.html`), `<html><body><section id="${storyId}:AC1">proof</section></body></html>\n`, "utf8");
  writePeerScore(root, storyId, cycleId);
}

describe("US-QA-016 fault injection matrix", () => {
  it("[FI-01] shared checkout pollution is quarantined, restored, and dispatch continues", async () => {
    const cycleId = "20260703-010101-fi01";
    const { repo } = makeFixture("fi01", cycleId);
    const runtimeDir = join(repo, ".roll", "loop");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(repo, "app.txt"), "leaked product edit\n", "utf8");
    writeFileSync(join(repo, "leak.txt"), "untracked leak\n", "utf8");

    const quarantined = await quarantineMainCheckout({ repoCwd: repo, runtimeDir, cycleId, storyId: "US-RUN-001", phase: "pre-spawn", nowMs: () => 1_780_000_000_000 });
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ type: "sandbox:quarantined", reason: "dirty", files: ["app.txt", "leak.txt"] });
    expect(git(repo, ["status", "--porcelain", "--", "app.txt", "leak.txt"])).toBe("");

    const rt = tmp("fi01-rt");
    const p = paths(rt, cycleId);
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });
    const result = await runCycleOnce({
      ports: { ...base, agentSpawn: shimAgentTcr, github: fakeGithub(0) },
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });
    expect(result.terminal).toBe("published");
  });

  it("[FI-02] attest render failure blocks publish and records a loud gate verdict", () => {
    const storyId = "US-QA16-RENDER";
    const cycleId = "c-fi02";
    const wt = tmp("fi02-wt");
    writeAttestCard(wt, storyId, [{ ac: `${storyId}:AC1`, status: "pass", evidence: [{ kind: "text", textFile: "evidence/proof.txt" }] }], cycleId);
    const { alerts, events, s } = attestSinks();

    const r = runAttestGate(wt, storyId, cycleId, "hard", 1000, s, wt, "builder-session", 7);

    expect(r).toMatchObject({ verdict: "skipped", blocked: true });
    expect(r.reasons[0]).toContain("attest render failed");
    expect(alerts.join("\n")).toContain("BLOCKED");
    expect(events[0]).toMatchObject({ cycleId, verdict: "skipped" });
  });

  it("[FI-03] dangling ac-map evidence path is rejected by the merge gate", () => {
    const storyId = "US-QA16-ACMAP";
    const cycleId = "c-fi03";
    const wt = tmp("fi03-wt");
    writeAttestCard(wt, storyId, [{ ac: `${storyId}:AC1`, status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/missing.png" }] }], cycleId);
    const { alerts, s } = attestSinks();

    const r = runAttestGate(wt, storyId, cycleId, "hard", 1000, s, wt, "builder-session");

    expect(r.blocked).toBe(true);
    expect(r.reasons.join("\n")).toContain("unresolved acceptance evidence path");
    expect(alerts.join("\n")).toContain("unresolved acceptance evidence");
  });

  it("[FI-04] provider/auth and CI-unavailable envelopes pause by root cause and keep diagnostics off the card", () => {
    const rt = tmp("fi04-rt");
    const auth = classifyFailure({ stage: "auth", source: "agent:auth", tcrCount: 0 });
    const ci = classifyFailure({ stage: "publish", source: "publish:ci_unavailable", tcrCount: 0 });

    expect(auth).toMatchObject({ failureClass: "env", rootCauseKey: "env:auth" });
    expect(ci).toMatchObject({ failureClass: "harness", rootCauseKey: "harness:publish" });

    const authPause = recordRootCauseFailure(rt, "c-fi04-auth", auth, [{ type: "agent:blocked", cycleId: "c-fi04-auth", stage: "build", cause: "auth", agent: "reasonix", ts: 1 } as never], 1);
    const ciPause = recordRootCauseFailure(rt, "c-fi04-ci", ci, [{ type: "cycle:end", cycleId: "c-fi04-ci", outcome: "failed", ts: 2 } as never], 1);

    expect(authPause).toMatchObject({ paused: true, rootCauseKey: "env:auth" });
    expect(ciPause).toMatchObject({ paused: true, rootCauseKey: "harness:publish" });
    expect(authPause.snapshotPath !== undefined && existsSync(authPause.snapshotPath)).toBe(true);
    expect(ciPause.snapshotPath !== undefined && existsSync(ciPause.snapshotPath)).toBe(true);
    expect(recordCardFailure(rt, "US-RUN-001", 1, auth.failureClass).nowSkipped).toBe(false);
    expect(readSkipCards(rt).has("US-RUN-001")).toBe(false);
  });

  it("[FI-05] dirty .roll meta is ignored by product checkout dirt checks", async () => {
    const { repo } = makeFixture("fi05");
    writeFileSync(join(repo, ".roll", "backlog.md"), `${BACKLOG}\n# owner note\n`, "utf8");
    mkdirSync(join(repo, ".roll", "loop"), { recursive: true });
    writeFileSync(join(repo, ".roll", "loop", "events.ndjson"), "runtime\n", "utf8");

    await expect(checkMainDirty(repo)).resolves.toEqual([]);

    writeFileSync(join(repo, "app.txt"), "real product leak\n", "utf8");
    await expect(checkMainDirty(repo)).resolves.toEqual(["app.txt"]);
  });

  it("[FI-06] concurrent loops contending for one card do not double-deliver", async () => {
    const decision = scheduleParallelCycles({
      maxParallelCycles: 2,
      budgetOk: true,
      active: [{ storyId: "US-RUN-001", files: ["app.txt"] }],
      openPrStories: [],
      candidates: [{ storyId: "US-RUN-001", files: ["app.txt"] }],
    });
    expect(decision.start).toEqual([]);
    expect(decision.wait).toEqual([{ storyId: "US-RUN-001", reason: "already in flight (active cycle or open PR)" }]);

    const cycleId = "20260703-060606-fi06";
    const { repo } = makeFixture("fi06", cycleId);
    const rt = tmp("fi06-rt");
    const p = paths(rt, cycleId);
    mkdirSync(rt, { recursive: true });
    writeFileSync(p.lockPath, `${process.pid}:${Math.floor(Date.now() / 1000)}\n`, "utf8");
    const base = nodePorts({ repoCwd: repo, paths: p, skillBody: "deliver", routeDeps });

    const result = await runCycleOnce({
      ports: { ...base, agentSpawn: shimAgentTcr, github: fakeGithub(0) },
      ctx: { cycleId, branch: `loop/cycle-${cycleId}`, loop: "ci" as never },
    });

    expect(result.ran).toBe(false);
    expect(result.heldByPid).toBe(process.pid);
  });

  it("[FI-07] a pardoned card is rearmed and can be scheduled to delivery", async () => {
    const rt = tmp("fi07-rt");
    expect(recordCardFailure(rt, "US-RUN-001", 1, "card")).toEqual({ count: 1, nowSkipped: true });
    expect(readSkipCards(rt).has("US-RUN-001")).toBe(true);

    clearCardFailure(rt, "US-RUN-001");
    expect(readSkipCards(rt).has("US-RUN-001")).toBe(false);

    const { result } = await runFixtureCycle("fi07", "20260703-070707-fi07");
    expect(result.ran).toBe(true);
    expect(result.terminal).toBe("published");
  });
});
