/**
 * US-OBS-016 AC4 — view-model deterministic test for collectDossierState.
 *
 * Verifies that collectDossierState returns a stable TruthSnapshot for a fixed
 * fixture, and that individual collector errors degrade the affected surface
 * without crashing the whole snapshot.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { collectDossierState, type CollectorDeps } from "../src/truth/collect-dossier-state.js";
import { serializeTruthSnapshot } from "@roll/spec";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/**
 * Fixture: one epic "alpha" with two stories.
 *   - US-A-1: delivered (has latest/), NO backlog entry → delivered by latest pointer
 *   - FIX-2: not delivered, NO latest/, NO backlog entry → todo
 *
 * Using archive-only stories (no backlog entry) means the dossier relies on
 * on-disk pointers rather than the truth selector's merge-evidence requirement.
 */
function standardFixture(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-cds-std-")));
  dirs.push(p);
  const f = join(p, ".roll", "features");
  // ensure .roll dir exists (collectDossier needs it)
  mkdirSync(join(p, ".roll"), { recursive: true });

  // US-A-1: delivered via latest pointer
  mkdirSync(join(f, "alpha", "US-A-1", "2026-06-01T00-00-00"), { recursive: true });
  symlinkSync(join(f, "alpha", "US-A-1", "2026-06-01T00-00-00"), join(f, "alpha", "US-A-1", "latest"));
  writeFileSync(
    join(f, "alpha", "US-A-1", "spec.md"),
    "---\nid: US-A-1\ntitle: Alpha story\ntype: us\ncreated: 2026-06-01\n---\n\n# US-A-1 — Alpha story\n",
  );

  // FIX-2: not delivered, no latest
  mkdirSync(join(f, "alpha", "FIX-2"), { recursive: true });
  writeFileSync(join(f, "alpha", "FIX-2", "spec.md"), "---\nid: FIX-2\ntype: fix\n---\n# FIX-2 — Fix a thing\n");
  return p;
}

describe("collectDossierState — view-model determinism (US-OBS-016 AC4)", () => {
  it("returns a deterministic snapshot for a fixed fixture (default deps)", () => {
    const cwd = standardFixture();
    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const snapshot = collectDossierState(cwd);
      expect(snapshot).toBeDefined();
      expect(snapshot.generatedAt).toBe("2026-06-20T12:00:00Z");
      // story aggregate: 1 done (US-A-1, latest pointer), 1 todo (FIX-2)
      expect(snapshot.story.total).toBe(2);
      expect(snapshot.story.spectrum.done).toBe(1);
      expect(snapshot.story.spectrum.todo).toBe(1);
      // loop heartbeat present (best-effort from disk)
      expect(snapshot.loop).toBeDefined();
      expect(snapshot.loop!.lanes.length).toBeGreaterThanOrEqual(0);
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });

  it("serialized snapshot is stable (deterministic JSON)", () => {
    const cwd = standardFixture();
    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const a = collectDossierState(cwd);
      const b = collectDossierState(cwd);
      expect(serializeTruthSnapshot(a)).toBe(serializeTruthSnapshot(b));
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });

  it("snapshot has expected shape keys with stories registry", () => {
    const cwd = standardFixture();
    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const snapshot = collectDossierState(cwd);
      expect(snapshot).toHaveProperty("generatedAt");
      expect(snapshot).toHaveProperty("story");
      expect(snapshot.story).toHaveProperty("total");
      expect(snapshot.story).toHaveProperty("spectrum");
      expect(snapshot.story).toHaveProperty("legacy");
      // stories[] registry rides the snapshot (US-DOSSIER-021)
      expect(snapshot).toHaveProperty("stories");
      expect(Array.isArray(snapshot.stories)).toBe(true);
      expect(snapshot.stories!.length).toBe(2);
      // deterministic ordering: stories sorted by id within epic
      const ids = snapshot.stories!.map((s) => s.id);
      expect(ids).toEqual(["FIX-2", "US-A-1"]);
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });

  it("handles empty features dir cleanly (no crash)", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-cds-empty-")));
    dirs.push(p);
    mkdirSync(join(p, ".roll"), { recursive: true });
    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const snapshot = collectDossierState(p);
      expect(snapshot).toBeDefined();
      expect(snapshot.story.total).toBe(0);
      expect(snapshot.stories).toEqual([]);
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });

  it("multiple epics produce correct deterministic spectrum", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-cds-multi-")));
    dirs.push(p);
    mkdirSync(join(p, ".roll"), { recursive: true });
    const f = join(p, ".roll", "features");

    // epic alpha: US-A-1 done (has latest), FIX-2 not done
    mkdirSync(join(f, "alpha", "US-A-1", "dummy"), { recursive: true });
    symlinkSync(join(f, "alpha", "US-A-1", "dummy"), join(f, "alpha", "US-A-1", "latest"));
    writeFileSync(join(f, "alpha", "US-A-1", "spec.md"), "---\nid: US-A-1\ntype: us\n---\n# US-A-1\n");
    mkdirSync(join(f, "alpha", "FIX-2"), { recursive: true });
    writeFileSync(join(f, "alpha", "FIX-2", "spec.md"), "---\nid: FIX-2\ntype: fix\n---\n# FIX-2\n");

    // epic beta: US-B-1 done (has latest)
    mkdirSync(join(f, "beta", "US-B-1", "dummy"), { recursive: true });
    symlinkSync(join(f, "beta", "US-B-1", "dummy"), join(f, "beta", "US-B-1", "latest"));
    writeFileSync(join(f, "beta", "US-B-1", "spec.md"), "---\nid: US-B-1\ntype: us\n---\n# US-B-1\n");

    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const snapshot = collectDossierState(p);
      expect(snapshot.story.total).toBe(3);
      expect(snapshot.story.spectrum.done).toBe(2);
      expect(snapshot.story.spectrum.todo).toBe(1);
      expect(snapshot.stories!.length).toBe(3);
      // deterministic: epics alpha before beta, within each epic stories by id
      const ids = snapshot.stories!.map((s) => s.id);
      expect(ids).toEqual(["FIX-2", "US-A-1", "US-B-1"]);
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });

  it("survives a missing .roll dir (returns empty snapshot)", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-cds-noroll-")));
    dirs.push(p);
    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const snapshot = collectDossierState(p);
      expect(snapshot).toBeDefined();
      expect(snapshot.story.total).toBe(0);
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });

  it("gracefully degrades when a wired collector throws — snapshot still returned", () => {
    // Use a minimal fixture, but inject a throwing collector
    const cwd = standardFixture();
    const deps: CollectorDeps = {
      collectEvidenceFlags: () => {
        throw new Error("simulated storage failure");
      },
    };
    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const snapshot = collectDossierState(cwd, { deps });
      // Snapshot still returned — no crash
      expect(snapshot).toBeDefined();
      expect(snapshot.story.total).toBe(2);
      expect(snapshot.stories).toBeDefined();
      expect(snapshot.stories!.length).toBe(2);
      // Evidence flags should be NO_EVIDENCE (all false) due to the throw
      for (const s of snapshot.stories!) {
        expect(s.evidence.report).toBe(false);
        expect(s.evidence.acMap).toBe(false);
        expect(s.evidence.visualEvidence).toBe(false);
      }
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });

  it("wired deps can override loop heartbeat", () => {
    const cwd = standardFixture();
    const deps: CollectorDeps = {
      collectLoopHeartbeat: () => ({
        lanes: [{ name: "test-lane", source: "launchd" as const, running: true, mode: "test" }],
      }),
    };
    process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00Z";
    try {
      const snapshot = collectDossierState(cwd, { deps });
      expect(snapshot.loop).toBeDefined();
      expect(snapshot.loop!.lanes).toHaveLength(1);
      expect(snapshot.loop!.lanes[0].name).toBe("test-lane");
    } finally {
      delete process.env["ROLL_RENDER_NOW"];
    }
  });
});
