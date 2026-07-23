/**
 * US-V4-022 — Supervisor agent toolchain health classification.
 */
import { describe, expect, it } from "vitest";
import {
  classifyAgentToolchainSignal,
  recommendAgentHealthAction,
  gatherAgentToolchainIssues,
} from "../src/supervisor/agent-health.js";
import type { AgentToolchainSignal, RollEvent } from "@roll/spec";

const signal = (over: Partial<AgentToolchainSignal> = {}): AgentToolchainSignal => ({
  agent: "reasonix",
  message: "warning: skill \"skill-authoring\" has no description",
  source: "setup",
  ...over,
});

describe("classifyAgentToolchainSignal", () => {
  it("classifies Reasonix missing-description warnings as setup/skill-root pollution", () => {
    const s = signal({
      agent: "reasonix",
      message: 'warning: skill "skill-authoring" at /Users/x/.reasonix/skills/docs/skill-authoring.md has no description',
      context: { skillRoot: "/Users/x/.reasonix/skills/docs" },
    });
    expect(classifyAgentToolchainSignal(s)).toEqual({
      classification: "setup_skill_root_pollution",
      severity: "warning",
    });
  });

  it("classifies auth keywords as auth_block", () => {
    expect(classifyAgentToolchainSignal(signal({ message: "403 Forbidden: auth expired" }))).toEqual({
      classification: "auth_block",
      severity: "error",
    });
    expect(classifyAgentToolchainSignal(signal({ message: "Unauthorized: please run /login" }))).toEqual({
      classification: "auth_block",
      severity: "error",
    });
  });

  it("classifies network keywords as network_block", () => {
    expect(classifyAgentToolchainSignal(signal({ message: "ECONNREFUSED: cannot reach API" }))).toEqual({
      classification: "network_block",
      severity: "error",
    });
    expect(classifyAgentToolchainSignal(signal({ message: "ETIMEDOUT" }))).toEqual({
      classification: "network_block",
      severity: "error",
    });
  });

  it("classifies worktree permission failures", () => {
    const s = signal({
      message: "EACCES: permission denied, mkdir '/path/to/worktree/.roll'",
      context: { worktreePath: "/path/to/worktree" },
    });
    expect(classifyAgentToolchainSignal(s)).toEqual({
      classification: "worktree_permission_failure",
      severity: "error",
    });
  });

  it("falls back to unknown_warning for unrecognised warnings", () => {
    expect(classifyAgentToolchainSignal(signal({ message: "some other warning" }))).toEqual({
      classification: "unknown_warning",
      severity: "warning",
    });
  });

  it("preserves explicit error severity when present", () => {
    expect(
      classifyAgentToolchainSignal(signal({ severity: "error", message: "some other warning" })),
    ).toEqual({
      classification: "unknown_warning",
      severity: "error",
    });
  });
});

describe("recommendAgentHealthAction", () => {
  it("routes setup/skill-root pollution to delivery team via create_fix", () => {
    expect(recommendAgentHealthAction("setup_skill_root_pollution")).toEqual({
      action: "create_fix",
      routing: "delivery_team",
    });
  });

  it("pauses for auth_block", () => {
    expect(recommendAgentHealthAction("auth_block")).toEqual({
      action: "pause_for_owner",
      routing: "owner",
    });
  });

  it("lets network_block continue as transient", () => {
    expect(recommendAgentHealthAction("network_block")).toEqual({
      action: "continue",
      routing: "none",
    });
  });

  it("pauses for worktree permission failures", () => {
    expect(recommendAgentHealthAction("worktree_permission_failure")).toEqual({
      action: "pause_for_owner",
      routing: "owner",
    });
  });

  it("continues for unknown warnings", () => {
    expect(recommendAgentHealthAction("unknown_warning")).toEqual({
      action: "continue",
      routing: "none",
    });
  });
});

describe("gatherAgentToolchainIssues", () => {
  it("reads agent:toolchain_issue events and classifies them", () => {
    const events: RollEvent[] = [
      {
        type: "agent:toolchain_issue",
        agent: "reasonix",
        classification: "setup_skill_root_pollution",
        severity: "warning",
        detail: 'skill "skill-authoring" has no description',
        source: "setup",
        storyId: "US-1",
        ts: 1,
      },
    ];
    const issues = gatherAgentToolchainIssues(events);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      agent: "reasonix",
      classification: "setup_skill_root_pollution",
      action: "create_fix",
      routing: "delivery_team",
    });
  });

  it("ignores non-toolchain events", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: "C1", storyId: "US-1", agent: "claude", model: "m", ts: 1 },
    ];
    expect(gatherAgentToolchainIssues(events)).toEqual([]);
  });

  it("classifies raw signals emitted as agent:blocked", () => {
    const events: RollEvent[] = [
      { type: "agent:blocked", cycleId: "C1", agent: "claude", cause: "auth", stage: "build", detail: "Please run /login", ts: 1 },
      { type: "agent:blocked", cycleId: "C2", agent: "pi", cause: "network", stage: "review", detail: "DNS failure", ts: 2 },
    ];
    const issues = gatherAgentToolchainIssues(events);
    expect(issues.map((i) => [i.agent, i.classification, i.action])).toEqual([
      ["claude", "auth_block", "pause_for_owner"],
      ["pi", "network_block", "continue"],
    ]);
  });
});
