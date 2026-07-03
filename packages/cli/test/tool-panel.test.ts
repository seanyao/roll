/**
 * US-TOOL-016 — pins the machine-global tool catalog collector: the full
 * built-in set is present, multi-tool kinds expand to multiple rows, a
 * no-`defaults` tool yields empty guardrails, and ordering is stable and
 * deterministic (no clock / RNG / network). The Tools page (US-TOOL-017)
 * renders from this single source of truth.
 */
import { describe, expect, it } from "vitest";
import { builtinToolDeclarations } from "@roll/infra";
import { collectToolPanel, type ToolPanelRow } from "../src/lib/tool-panel.js";

function row(rows: ToolPanelRow[], id: string): ToolPanelRow {
  const found = rows.find((r) => r.id === id);
  expect(found, `row ${id} should exist`).toBeDefined();
  return found!;
}

describe("collectToolPanel", () => {
  it("includes every built-in adapter (bash · browser·* · git·* · github·* · network · filesystem·* · mcp)", () => {
    const ids = collectToolPanel().map((r) => r.id);
    expect(ids).toEqual([
      "bash",
      "browser.console",
      "browser.dom-query",
      "browser.screenshot",
      "physical.screenshot",
      "filesystem.read",
      "filesystem.stat",
      "filesystem.write",
      "git.commit",
      "git.merge",
      "git.push",
      "git.status",
      "github.ci",
      "github.pr",
      "mcp.call",
      "network.fetch",
    ]);
  });

  it("has exactly one row per built-in declaration", () => {
    const rows = collectToolPanel();
    expect(rows.length).toBe(builtinToolDeclarations().length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("multi-tool kinds (browser · git · github · filesystem) expand to multiple rows", () => {
    const rows = collectToolPanel();
    const byKind = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.id);
    expect(byKind("browser")).toEqual(["browser.console", "browser.dom-query", "browser.screenshot", "physical.screenshot"]);
    expect(byKind("git")).toEqual(["git.commit", "git.merge", "git.push", "git.status"]);
    expect(byKind("github")).toEqual(["github.ci", "github.pr"]);
    expect(byKind("filesystem")).toEqual(["filesystem.read", "filesystem.stat", "filesystem.write"]);
    // single-tool kinds are exactly one row each
    expect(byKind("bash")).toEqual(["bash"]);
    expect(byKind("network")).toEqual(["network.fetch"]);
    expect(byKind("mcp")).toEqual(["mcp.call"]);
  });

  it("maps description / emitsEvents defaults per the rules", () => {
    const rows = collectToolPanel();
    // every built-in declares a description → never the "" fallback here, but
    // the fallback type is still exercised via the contract below.
    for (const r of rows) expect(typeof r.description).toBe("string");
    // git.status declares emitsEvents:false; the other git ops declare true.
    expect(row(rows, "git.status").emitsEvents).toBe(false);
    expect(row(rows, "git.commit").emitsEvents).toBe(true);
    expect(row(rows, "git.push").emitsEvents).toBe(true);
    expect(row(rows, "git.merge").emitsEvents).toBe(true);
    // bash declares no emitsEvents → defaults to false.
    expect(row(rows, "bash").emitsEvents).toBe(false);
  });

  it("summarizes guardrails from declaration.defaults (timeout · retries · sandbox · maxPerCycle)", () => {
    const rows = collectToolPanel();
    // bash: timeout + bounded-output sandbox, no retry, no maxPerCycle.
    expect(row(rows, "bash").guardrails).toEqual({ timeoutMs: 30_000, sandbox: "bounded-output" });
    // browser: headless sandbox.
    expect(row(rows, "browser.screenshot").guardrails).toEqual({ timeoutMs: 60_000, sandbox: "headless" });
    expect(row(rows, "physical.screenshot").guardrails).toEqual({ timeoutMs: 60_000, sandbox: "bounded-output" });
    // network: the only built-in with a retry policy (attempts → retries) and a network sandbox.
    expect(row(rows, "network.fetch").guardrails).toEqual({ timeoutMs: 30_000, retries: 1, sandbox: "network:restricted" });
    // mcp: network sandbox, no retry.
    expect(row(rows, "mcp.call").guardrails).toEqual({ timeoutMs: 30_000, sandbox: "network:restricted" });
    // no built-in declares maxInvocationsPerCycle → maxPerCycle is always omitted.
    expect(rows.every((r) => r.guardrails.maxPerCycle === undefined)).toBe(true);
  });

  it("a tool whose defaults set no sandbox yields guardrails without a sandbox label", () => {
    const rows = collectToolPanel();
    // git / github / filesystem declare timeoutMs only (no sandbox, no retry).
    expect(row(rows, "git.commit").guardrails).toEqual({ timeoutMs: 60_000 });
    expect(row(rows, "github.pr").guardrails).toEqual({ timeoutMs: 60_000 });
    expect(row(rows, "filesystem.stat").guardrails).toEqual({ timeoutMs: 30_000 });
    expect(row(rows, "git.commit").guardrails.sandbox).toBeUndefined();
    expect(row(rows, "git.commit").guardrails.retries).toBeUndefined();
  });

  it("maps requirements to labels, and [] when a declaration has none", () => {
    const rows = collectToolPanel();
    expect(row(rows, "bash").requirements).toEqual(["system-shell"]);
    expect(row(rows, "browser.screenshot").requirements).toEqual(["playwright-chromium (optional)"]);
    expect(row(rows, "physical.screenshot").requirements).toEqual(["roll-capture-app (service)"]);
    expect(row(rows, "git.commit").requirements).toEqual(["git"]);
    expect(row(rows, "github.pr").requirements).toEqual(["gh"]);
    // network / filesystem / mcp declare no requirements → [].
    expect(row(rows, "network.fetch").requirements).toEqual([]);
    expect(row(rows, "filesystem.stat").requirements).toEqual([]);
    expect(row(rows, "mcp.call").requirements).toEqual([]);
  });

  it("US-TOOL-021: carries live requirement details under each tool row", () => {
    const rows = collectToolPanel();
    expect(row(rows, "bash").requirementDetails).toEqual([
      expect.objectContaining({ name: "system-shell", label: "system-shell", status: "ok", optional: false }),
    ]);
    expect(row(rows, "browser.screenshot").requirementDetails).toEqual([
      expect.objectContaining({ name: "playwright-chromium", label: "playwright-chromium (optional)", optional: true }),
    ]);
    expect(row(rows, "physical.screenshot").requirementDetails).toEqual([
      expect.objectContaining({ name: "roll-capture-app", label: "roll-capture-app (service)", optional: false }),
    ]);
    expect(row(rows, "github.pr").requirementDetails).toEqual([
      expect.objectContaining({ name: "gh", label: "gh", optional: false }),
    ]);
    expect(row(rows, "network.fetch").requirementDetails).toEqual([]);
  });

  it("derives tool readiness from resolved requirements", () => {
    const rows = collectToolPanel();
    expect(row(rows, "bash").readiness).toBe("available");
    expect(["available", "degraded"]).toContain(row(rows, "browser.screenshot").readiness);
    expect(row(rows, "physical.screenshot").readiness).toBe("unavailable");
    expect(["available", "unavailable"]).toContain(row(rows, "github.pr").readiness);
  });

  it("keeps requirements as host resources and never models tool-to-tool dependencies", () => {
    for (const declaration of builtinToolDeclarations()) {
      for (const requirement of declaration.requirements ?? []) {
        expect(requirement.kind).not.toBe("tool");
      }
    }
  });

  it("is deterministic: byte-stable across runs and sorted by (kind, id)", () => {
    const a = collectToolPanel();
    const b = collectToolPanel();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // (kind, id) ascending: kind is the primary key, id the tiebreak.
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1]!;
      const cur = a[i]!;
      const order = String(prev.kind).localeCompare(String(cur.kind)) || prev.id.localeCompare(cur.id);
      expect(order).toBeLessThanOrEqual(0);
    }
  });
});

describe("builtinToolDeclarations", () => {
  it("returns every built-in adapter declaration in (kind, id) order with no side-effect drift", () => {
    const a = builtinToolDeclarations();
    const b = builtinToolDeclarations();
    expect(a.map((d) => String(d.id))).toEqual(b.map((d) => String(d.id)));
    expect(a.map((d) => String(d.id))).toEqual([
      "bash",
      "browser.console",
      "browser.dom-query",
      "browser.screenshot",
      "physical.screenshot",
      "filesystem.read",
      "filesystem.stat",
      "filesystem.write",
      "git.commit",
      "git.merge",
      "git.push",
      "git.status",
      "github.ci",
      "github.pr",
      "mcp.call",
      "network.fetch",
    ]);
  });
});
