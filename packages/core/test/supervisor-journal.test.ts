import { describe, expect, it } from "vitest";
import { buildJournalView, countJournalEntries, latestJournalEntry, renderJournal } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

function journal(
  ts: number,
  action: "decide" | "verify" | "rescue" | "escalate" | "note",
  storyId?: string,
  note?: string,
): RollEvent {
  return {
    type: "supervisor:journal",
    ts,
    actor: "owner",
    action,
    storyId,
    note,
  };
}

describe("buildJournalView", () => {
  it("returns supervisor:journal events newest first", () => {
    const events: RollEvent[] = [
      journal(100, "decide", "US-A", "pick next"),
      journal(200, "verify", "US-B", "ci green"),
      { type: "cycle:start", cycleId: "c1", storyId: "US-A", agent: "kimi", model: "kimi", ts: 150 },
    ];
    const view = buildJournalView(events);
    expect(view).toHaveLength(2);
    expect(view[0]?.ts).toBe(200);
    expect(view[1]?.ts).toBe(100);
  });

  it("filters by storyId", () => {
    const events: RollEvent[] = [
      journal(100, "decide", "US-A"),
      journal(200, "rescue", "US-OBS-048"),
      journal(300, "verify", "US-A"),
    ];
    const view = buildJournalView(events, { storyId: "US-A" });
    expect(view).toHaveLength(2);
    expect(view.every((e) => e.storyId === "US-A")).toBe(true);
  });

  it("limits results", () => {
    const events: RollEvent[] = Array.from({ length: 5 }, (_, i) => journal(i * 10, "note"));
    const view = buildJournalView(events, { limit: 3 });
    expect(view).toHaveLength(3);
  });

  it("defaults evidence to empty array", () => {
    const events: RollEvent[] = [journal(100, "note", "US-A")];
    const view = buildJournalView(events);
    expect(view[0]?.evidence).toEqual([]);
  });
});

describe("latestJournalEntry", () => {
  it("returns undefined when no journal events exist", () => {
    expect(latestJournalEntry([])).toBeUndefined();
  });

  it("returns the newest journal entry", () => {
    const events: RollEvent[] = [journal(100, "decide"), journal(200, "rescue")];
    const latest = latestJournalEntry(events);
    expect(latest?.action).toBe("rescue");
    expect(latest?.ts).toBe(200);
  });
});

describe("countJournalEntries", () => {
  it("counts only supervisor:journal events", () => {
    const events: RollEvent[] = [
      journal(100, "decide"),
      { type: "cycle:end", cycleId: "c1", outcome: "failed", cost: {}, ts: 100 },
      journal(200, "verify"),
    ];
    expect(countJournalEntries(events)).toBe(2);
  });
});

describe("renderJournal", () => {
  it("renders empty state bilingually", () => {
    const out = renderJournal([], "en");
    expect(out).toContain("Supervisor journal");
    expect(out).toContain("no journal entries");
  });

  it("renders rows with action and note preview", () => {
    const out = renderJournal(
      [{
        ts: Date.parse("2026-07-04T12:00:00Z"),
        actor: "owner",
        action: "rescue",
        storyId: "US-OBS-048",
        note: "rerouted to codex after auth block",
        evidence: [],
      }],
      "en",
    );
    expect(out).toContain("rescue");
    expect(out).toContain("US-OBS-048");
    expect(out).toContain("rerouted to codex after auth block");
  });
});
