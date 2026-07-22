import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentCapacityAcquireRequest, NormalizedAgentCapacityPolicy } from "@roll/spec";
import { NodeAgentCapacityBroker } from "../src/agent-capacity.js";

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `roll-${label}-`));
}

const POLICY: NormalizedAgentCapacityPolicy = {
  global: 2,
  perAgent: { codex: 1, claude: 1 },
  heartbeatSeconds: 10,
  staleAfterSeconds: 30,
};

function request(
  cycleId: string,
  agent: "codex" | "claude" = "codex",
  overrides: Partial<AgentCapacityAcquireRequest["owner"]> = {},
): AgentCapacityAcquireRequest {
  return {
    key: { agent, model: `${agent}-model`, contextKey: `${agent}-account` },
    owner: {
      leaseId: `lease-${cycleId}`,
      ownerToken: `token-${cycleId}`,
      workspaceId: `workspace-${cycleId}`,
      storyId: `US-${cycleId}`,
      cycleId,
      spawnId: `spawn-${cycleId}`,
      host: hostname(),
      pid: 1000,
      processStartedAtMs: 500,
      ...overrides,
    },
  };
}

function broker(root: string, now = 1_000) {
  return new NodeAgentCapacityBroker({
    root,
    policy: POLICY,
    clockMs: () => now,
    host: hostname(),
    processIdentity: (pid) => pid === 1000 ? { alive: true, startedAtMs: 500 } : { alive: false },
  });
}

describe("NodeAgentCapacityBroker", () => {
  it("enforces per-agent aggregation across model and context while distinct slots run", () => {
    const root = tempDir("capacity-limits");
    const first = broker(root).acquire(request("one"));
    const sameAgent = broker(root).acquire({
      ...request("two"),
      key: { agent: "codex", model: "other-model", contextKey: "other-account" },
    });
    const distinct = broker(root).acquire(request("three", "claude"));

    expect(first.kind).toBe("acquired");
    expect(sameAgent).toMatchObject({ kind: "waiting", suspect: false });
    expect(distinct.kind).toBe("acquired");
  });

  it("enforces the global limit under the same broker lock", () => {
    const root = tempDir("capacity-global");
    const limited = new NodeAgentCapacityBroker({
      root,
      policy: { ...POLICY, global: 1 },
      clockMs: () => 1_000,
      host: hostname(),
      processIdentity: () => ({ alive: true, startedAtMs: 500 }),
    });
    expect(limited.acquire(request("one")).kind).toBe("acquired");
    expect(limited.acquire(request("two", "claude"))).toMatchObject({ kind: "waiting", suspect: false });
  });

  it("requires exact ownership for heartbeat and release and makes repeated release idempotent", () => {
    const root = tempDir("capacity-owner");
    const acquired = broker(root).acquire(request("one"));
    expect(acquired.kind).toBe("acquired");
    expect(broker(root, 2_000).heartbeat("lease-one", "wrong-token")).toEqual({
      kind: "ownership_lost",
      reason: "owner_token_mismatch",
    });
    expect(broker(root, 2_000).heartbeat("lease-one", "token-one")).toEqual({ kind: "updated" });
    expect(broker(root).release("lease-one", "wrong-token")).toEqual({
      kind: "ownership_lost",
      reason: "owner_token_mismatch",
    });
    expect(broker(root).release("lease-one", "token-one")).toEqual({ kind: "released" });
    expect(broker(root).release("lease-one", "token-one")).toEqual({ kind: "already_released" });
  });

  it("reclaims only stale same-host dead owners", () => {
    const root = tempDir("capacity-dead");
    const first = new NodeAgentCapacityBroker({
      root,
      policy: { ...POLICY, global: 1 },
      clockMs: () => 1_000,
      host: hostname(),
      processIdentity: () => ({ alive: true, startedAtMs: 500 }),
    });
    expect(first.acquire(request("dead", "codex", { pid: 2000 })).kind).toBe("acquired");
    const reclaim = new NodeAgentCapacityBroker({
      root,
      policy: { ...POLICY, global: 1 },
      clockMs: () => 40_000,
      host: hostname(),
      processIdentity: () => ({ alive: false }),
    });
    expect(reclaim.acquire(request("next", "claude"))).toMatchObject({ kind: "acquired" });
  });

  it.each([
    ["live stale", hostname(), { alive: true, startedAtMs: 500 }],
    ["pid reuse", hostname(), { alive: true, startedAtMs: 999 }],
    ["cross host", "remote-host", { alive: false }],
  ] as const)("keeps %s leases suspect instead of stealing them", (_label, leaseHost, identity) => {
    const root = tempDir("capacity-suspect");
    const initial = new NodeAgentCapacityBroker({
      root,
      policy: { ...POLICY, global: 1 },
      clockMs: () => 1_000,
      host: hostname(),
      processIdentity: () => ({ alive: true, startedAtMs: 500 }),
    });
    expect(initial.acquire(request("old", "codex", { host: leaseHost })).kind).toBe("acquired");
    const later = new NodeAgentCapacityBroker({
      root,
      policy: { ...POLICY, global: 1 },
      clockMs: () => 40_000,
      host: hostname(),
      processIdentity: () => identity,
    });
    expect(later.acquire(request("next", "claude"))).toMatchObject({ kind: "waiting", suspect: true });
  });

  it("keeps unknown-schema files suspect and never deletes them", () => {
    const root = tempDir("capacity-unknown");
    const leases = join(root, "leases");
    mkdirSync(leases, { recursive: true });
    const path = join(leases, "future.json");
    writeFileSync(path, JSON.stringify({ schema: "roll-agent-capacity-lease/v2", private: "keep" }));

    expect(broker(root, 40_000).acquire(request("next"))).toMatchObject({ kind: "waiting", suspect: true });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      schema: "roll-agent-capacity-lease/v2",
      private: "keep",
    });
  });
});
