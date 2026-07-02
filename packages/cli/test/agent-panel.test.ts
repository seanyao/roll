/** US-DOSSIER-014 — agents-on-this-machine panel collector. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectAgentPanel } from "../src/lib/agent-panel.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(rows: object[]): string {
  const p = mkdtempSync(join(tmpdir(), "roll-agp-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

const NOW = Math.floor(Date.parse("2026-06-13T00:00:00Z") / 1000);

describe("collectAgentPanel", () => {
  it("aggregates 72h cycles + spend per agent; installed first; honest dashes", () => {
    const p = project([
      { agent: "claude", ts: "2026-06-12T01:00:00Z", cost_usd: 0.5 },
      { agent: "claude", ts: "2026-06-12T02:00:00Z", cost_effective_usd: 0.25 },
      { agent: "pi", ts: "2026-06-12T03:00:00Z", cost_usd: 0.1 },
      { agent: "claude", ts: "2026-06-01T00:00:00Z", cost_usd: 9 }, // outside window
    ]);
    const rows = collectAgentPanel(p, { installed: () => ["claude", "pi"], versionOf: () => null, nowSec: () => NOW, aiEntries: () => [] });
    const claude = rows.find((r) => r.name === "claude")!;
    expect(claude.cycles72h).toBe(2);
    expect(claude.costUsd72h).toBeCloseTo(0.75);
    expect(claude.runner).toBe("Claude Code");
    expect(claude.version).toBe("—");
    expect(claude.installed).toBe(true);
    expect(rows[0]?.installed).toBe(true); // installed sort first
  });

  it("agents without runs still appear with zero activity", () => {
    const p = project([]);
    const rows = collectAgentPanel(p, { installed: () => ["kimi"], versionOf: () => "1.2.3", nowSec: () => NOW, aiEntries: () => [] });
    const kimi = rows.find((r) => r.name === "kimi")!;
    expect(kimi.cycles72h).toBe(0);
    expect(kimi.version).toBe("1.2.3");
  });

  it("kimi pair-review: numeric epoch ts rows count toward the window", () => {
    const p = project([{ agent: "claude", ts: NOW - 3600, cost_usd: 0.2 }]);
    const rows = collectAgentPanel(p, { installed: () => ["claude"], versionOf: () => null, nowSec: () => NOW, aiEntries: () => [] });
    expect(rows.find((r) => r.name === "claude")?.cycles72h).toBe(1);
  });

  it("kimi pair-review: sync truth comes from injected entries, not the real config", () => {
    const p = project([]);
    const rows = collectAgentPanel(p, {
      installed: () => ["kimi"],
      versionOf: () => null,
      nowSec: () => NOW,
      aiEntries: () => [{ name: "kimi", ai_dir: "/nonexistent/.kimi", cfg_file: "AGENTS.md", src_file: "AGENTS.md" }],
    });
    const kimi = rows.find((r) => r.name === "kimi")!;
    expect(kimi.files[0]?.state).toBe("missing");
    expect(kimi.syncStale).toBe(true);
    expect(kimi.setupCmd).toBe("roll setup -f");
  });

  it("installed + config entry for the same agent merge into one row", () => {
    const p = project([]);
    const rows = collectAgentPanel(p, {
      installed: () => ["kimi"],
      versionOf: () => null,
      nowSec: () => NOW,
      aiEntries: () => [{ name: "kimi", ai_dir: "/nonexistent/.kimi", cfg_file: "AGENTS.md", src_file: "AGENTS.md" }],
    });
    expect(rows.filter((r) => r.name === "kimi")).toHaveLength(1);
  });
});
