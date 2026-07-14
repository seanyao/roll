import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configuredModelBackstop } from "../src/runner/node-ports.js";

/**
 * FIX-1249 — a pool-picked agent (a `select` role pool carries no per-route
 * model) still runs its CONFIGURED model, resolved from the project's `rigs:`,
 * never a source-baked default.
 */
describe("FIX-1249 — config-rig model backstop for pool-picked agents", () => {
  function project(agentsYaml: string): string {
    const p = mkdtempSync(join(tmpdir(), "roll-backstop-"));
    mkdirSync(join(p, ".roll"), { recursive: true });
    writeFileSync(join(p, ".roll", "agents.yaml"), agentsYaml);
    return p;
  }

  const YAML = [
    "schema: roll-agents/v1",
    "rigs:",
    "  reasonix-pro:",
    "    agent: reasonix",
    "    model: deepseek-v4-pro",
    "  kimi-strong:",
    "    agent: kimi",
    "routing:",
    "  easy: reasonix-pro",
  ].join("\n");

  it("resolves a pool-picked agent's model from a rig that binds it", () => {
    const p = project(YAML);
    expect(configuredModelBackstop(p, "reasonix")).toBe("deepseek-v4-pro");
  });

  it("returns '' when config binds the agent with no model (spawn omits --model)", () => {
    const p = project(YAML);
    expect(configuredModelBackstop(p, "kimi")).toBe("");
  });

  it("returns '' when no config file exists (stays config-driven, no source default)", () => {
    const p = mkdtempSync(join(tmpdir(), "roll-backstop-empty-"));
    expect(configuredModelBackstop(p, "reasonix")).toBe("");
  });

  it("empty agent name yields ''", () => {
    const p = project(YAML);
    expect(configuredModelBackstop(p, "")).toBe("");
  });
});
