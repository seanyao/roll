/**
 * US-DOSSIER-010 — `roll index` writes truth.json next to index.html, embeds
 * the SAME serialized snapshot in the page, and never swallows failures in the
 * cycle aggregate (the FIX-248 regression pinned for good).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexCommand } from "../src/commands/index-gen.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_RENDER_NOW"];
});

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-truthsnap-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  writeFileSync(
    join(p, ".roll", "backlog.md"),
    [
      "| Story | Description | Status |",
      "|---|---|---|",
      "| US-T-1 | a | ✅ Done |",
      "| US-T-2 | b | 📋 Todo |",
      "| US-T-3 | c | 🔨 In Progress |",
      "| US-T-4 | d | 🚫 Hold |",
    ].join("\n") + "\n",
  );
  for (const id of ["US-T-1", "US-T-2", "US-T-3", "US-T-4"]) {
    mkdirSync(join(p, ".roll", "features", "alpha", id), { recursive: true });
    writeFileSync(join(p, ".roll", "features", "alpha", id, "spec.md"), `---\nid: ${id}\ntitle: t\n---\n# ${id}\n`);
  }
  // Cycle rows inside the 72h window: one delivered + failed/reverted/blocked.
  const rows = [
    { cycle_id: "c1", status: "done", outcome: "delivered", merge_commit: "abc", cost_usd: 0.5, ts: "2026-06-12T20:00:00Z" },
    { cycle_id: "c2", status: "failed", ts: "2026-06-12T21:00:00Z", cost_usd: 0.1 },
    { cycle_id: "c3", status: "reverted", ts: "2026-06-12T22:00:00Z", cost_usd: 0.1 },
    { cycle_id: "c4", status: "blocked", ts: "2026-06-12T23:00:00Z", cost_usd: 0.1 },
  ];
  writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

async function runIndex(p: string): Promise<void> {
  const save = process.cwd();
  process.chdir(p);
  const o = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    expect(indexCommand([])).toBe(0);
  } finally {
    process.stdout.write = o;
    process.chdir(save);
  }
}

describe("US-DOSSIER-010 — truth.json next to index.html", () => {
  it("writes the snapshot file with story/cycle aggregates and a generated stamp", async () => {
    const p = project();
    process.env["ROLL_RENDER_NOW"] = "2026-06-13T00:00:00Z";
    await runIndex(p);
    const path = join(p, ".roll", "features", "truth.json");
    expect(existsSync(path)).toBe(true);
    const snap = JSON.parse(readFileSync(path, "utf8"));
    expect(snap.generatedAt).toBe("2026-06-13T00:00:00Z");
    expect(snap.story.total).toBe(4);
    expect(Object.values(snap.story.spectrum).reduce((a: number, b) => a + (b as number), 0)).toBe(4);
    expect(snap.cycle.cycles3d).toBe(4);
  });

  it("AC3: the page embed and truth.json come from the same serialization", async () => {
    const p = project();
    process.env["ROLL_RENDER_NOW"] = "2026-06-13T00:00:00Z";
    await runIndex(p);
    const file = readFileSync(join(p, ".roll", "features", "truth.json"), "utf8");
    const html = readFileSync(join(p, ".roll", "features", "index.html"), "utf8");
    const m = /<script id="roll-truth" type="application\/json">\n([\s\S]*?)<\/script>/.exec(html);
    expect(m?.[1]).toBeDefined();
    const embedded = (m?.[1] ?? "").replace(/<\\\//g, "</");
    expect(embedded).toBe(file); // byte-equal: same object, same serialization
    expect(JSON.parse(embedded)).toEqual(JSON.parse(file));
  });

  it("AC4 (FIX-248 regression): failed3d counts failed + reverted + blocked, equals the row-by-row sum", async () => {
    const p = project();
    process.env["ROLL_RENDER_NOW"] = "2026-06-13T00:00:00Z";
    await runIndex(p);
    const snap = JSON.parse(readFileSync(join(p, ".roll", "features", "truth.json"), "utf8"));
    expect(snap.cycle.failed3d).toBe(3); // c2 failed + c3 reverted + c4 blocked; c1 delivered not counted
  });

  // US-DOSSIER-021 — the per-story ladder + evidence registry rides the ONE snapshot.
  it("US-DOSSIER-021: truth.json carries stories[] with ladder + evidence; aggregate unchanged; embed === file", async () => {
    const p = project();
    process.env["ROLL_RENDER_NOW"] = "2026-06-13T00:00:00Z";
    await runIndex(p);
    const file = readFileSync(join(p, ".roll", "features", "truth.json"), "utf8");
    const snap = JSON.parse(file);
    // aggregate is unchanged: still 4 stories, sums to total.
    expect(snap.story.total).toBe(4);
    expect(Object.values(snap.story.spectrum).reduce((a: number, b) => a + (b as number), 0)).toBe(4);
    // the registry has one row per story, deterministic epic→id order.
    expect(Array.isArray(snap.stories)).toBe(true);
    expect(snap.stories.map((s: { id: string }) => s.id)).toEqual(["US-T-1", "US-T-2", "US-T-3", "US-T-4"]);
    for (const row of snap.stories) {
      expect(row).toHaveProperty("epic", "alpha");
      expect(["claimed", "merged", "attested", "none"]).toContain(row.ladder);
      expect(row.evidence).toHaveProperty("report");
      expect(row.evidence).toHaveProperty("acMap");
      expect(row.evidence).toHaveProperty("visualEvidence");
      expect(typeof row.legacy).toBe("boolean");
    }
    // the spectrum aggregate equals folding the registry's truthState column.
    const folded: Record<string, number> = { done: 0, wip: 0, hold: 0, todo: 0, fail: 0, unknown: 0 };
    for (const row of snap.stories) folded[row.truthState] += 1;
    expect(folded).toEqual(snap.story.spectrum);
    // AC3 still holds with the larger payload: the page embed === truth.json bytes.
    const html = readFileSync(join(p, ".roll", "features", "index.html"), "utf8");
    const m = /<script id="roll-truth" type="application\/json">\n([\s\S]*?)<\/script>/.exec(html);
    const embedded = (m?.[1] ?? "").replace(/<\\\//g, "</");
    expect(embedded).toBe(file);
  });
});
