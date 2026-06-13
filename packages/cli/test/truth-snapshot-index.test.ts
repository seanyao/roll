/**
 * US-DOSSIER-010 — `roll index` writes truth.json next to index.html, embeds
 * the SAME serialized snapshot in the page, and never swallows failures in the
 * cycle aggregate (the FIX-248 regression pinned for good).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexCommand } from "../src/commands/index-gen.js";

// FIX-283: a project root OUTSIDE the OS temp dir — the unconditional tmp-skip
// (AC3) means a cwd under tmpdir() is NEVER self-registered, even with ROLL_HOME
// set. The repo (worktree) root is not under tmpdir(), so a fixture under it is a
// "real" path for the skip rule's purposes. Cleaned up like the tmp fixtures.
const REPO_ROOT = resolve(__dirname, "../../..");

const dirs: string[] = [];
// FIX-281: redirect the cross-project registry into a tmp ROLL_HOME so the
// US-DOSSIER-028 self-register `roll index` performs can never write the real
// ~/.roll/projects.json during the suite.
let savedRollHome: string | undefined;
beforeEach(() => {
  savedRollHome = process.env["ROLL_HOME"];
  const h = mkdtempSync(join(tmpdir(), "roll-truthsnap-home-"));
  dirs.push(h);
  process.env["ROLL_HOME"] = h;
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_RENDER_NOW"];
  if (savedRollHome === undefined) delete process.env["ROLL_HOME"];
  else process.env["ROLL_HOME"] = savedRollHome;
});

function project(root: string = tmpdir()): string {
  const p = mkdtempSync(join(root, "roll-truthsnap-"));
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

  // FIX-283 — a REAL (non-tmp) project with ROLL_HOME set writes the cross-project
  // row ONLY to <ROLL_HOME>/.roll/projects.json, and the real ~/.roll/projects.json
  // is never touched. (Replaces the FIX-281 case that used a tmp project: under
  // FIX-283 a tmp cwd is now skipped unconditionally — covered below.)
  it("FIX-283: self-register honors ROLL_HOME — real project → sandbox registry only, real home untouched", async () => {
    const p = project(REPO_ROOT); // OUTSIDE tmpdir → a "real" path for the skip rule
    const sandbox = process.env["ROLL_HOME"]!; // set in beforeEach
    const realRegistry = join(homedir(), ".roll", "projects.json");
    const realBefore = existsSync(realRegistry) ? readFileSync(realRegistry, "utf8") : null;

    process.env["ROLL_RENDER_NOW"] = "2026-06-13T00:00:00Z";
    await runIndex(p);

    // the row landed in the tmp ROLL_HOME registry, pointing at this project.
    const sandboxRegistry = join(sandbox, ".roll", "projects.json");
    expect(existsSync(sandboxRegistry)).toBe(true);
    const rows = JSON.parse(readFileSync(sandboxRegistry, "utf8")) as Array<{ path: string }>;
    expect(rows.length).toBe(1);
    // index-gen records process.cwd(), which is the resolved realpath on macOS
    // (/var → /private/var); compare against the same resolution, not raw `p`.
    expect(rows[0]?.path).toBe(realpathSync(p));

    // the real ~/.roll/projects.json is byte-for-byte unchanged (and uncreated if
    // it never existed) — the whole point of the fix.
    const realAfter = existsSync(realRegistry) ? readFileSync(realRegistry, "utf8") : null;
    expect(realAfter).toBe(realBefore);
  });

  // FIX-283 (AC3) — robust tmp-skip: a tmp fixture cwd is skipped REGARDLESS of
  // whether ROLL_HOME is set. Even with ROLL_HOME pointing at a sandbox, a tmp
  // cwd is never self-registered (belt-and-suspenders beyond FIX-281), so a test
  // fixture can never leak even when a test forgot to sandbox ROLL_HOME.
  it("FIX-283: ROLL_HOME set + tmp cwd → self-register still skipped (sandbox stays empty)", async () => {
    const p = project(); // under tmpdir()
    const sandbox = process.env["ROLL_HOME"]!; // set in beforeEach
    const realRegistry = join(homedir(), ".roll", "projects.json");
    const realBefore = existsSync(realRegistry) ? readFileSync(realRegistry, "utf8") : null;

    process.env["ROLL_RENDER_NOW"] = "2026-06-13T00:00:00Z";
    await runIndex(p); // index still succeeds and renders the board

    expect(existsSync(join(p, ".roll", "features", "index.html"))).toBe(true);
    // tmp cwd → no row written, even to the sandbox registry.
    const sandboxRegistry = join(sandbox, ".roll", "projects.json");
    expect(existsSync(sandboxRegistry)).toBe(false);
    const realAfter = existsSync(realRegistry) ? readFileSync(realRegistry, "utf8") : null;
    expect(realAfter).toBe(realBefore); // real registry untouched
  });

  // FIX-281/FIX-283 belt-and-braces — with ROLL_HOME UNSET, a tmp fixture cwd is
  // skipped: the self-register never persists a throwaway row into the real registry.
  it("FIX-283: ROLL_HOME unset + tmp cwd → self-register skipped, real home untouched", async () => {
    const p = project();
    delete process.env["ROLL_HOME"]; // resolve to the REAL ~/.roll
    const realRegistry = join(homedir(), ".roll", "projects.json");
    const realBefore = existsSync(realRegistry) ? readFileSync(realRegistry, "utf8") : null;

    process.env["ROLL_RENDER_NOW"] = "2026-06-13T00:00:00Z";
    await runIndex(p); // index still succeeds and renders the board

    expect(existsSync(join(p, ".roll", "features", "index.html"))).toBe(true);
    const realAfter = existsSync(realRegistry) ? readFileSync(realRegistry, "utf8") : null;
    expect(realAfter).toBe(realBefore); // tmp fixture row was NOT persisted
  });
});
