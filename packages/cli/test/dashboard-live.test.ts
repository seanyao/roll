/**
 * FIX-203 — `roll loop status` must surface a LIVE v3 cycle.
 *
 * The v3 heart never writes the v2 `state.yaml` `status: running` line, so the
 * eyebrow (which read `state["status"]` only) showed IDLE / not-installed even
 * while a cycle was actively executing. Liveness must instead derive from the
 * v3 signals the runner DOES emit: a held `inner.lock` (live pid + fresh) + a
 * fresh `heartbeat` + a most-recent unclosed `cycle_start`.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dashboardCommand, detectLiveCycle, type Cycle } from "../src/commands/dashboard.js";
import { renderState } from "../src/render.js";

/** Capture dashboardCommand stdout with a scoped env + cwd. */
function tsRun(env: Record<string, string | undefined>, argv: string[], cwd: string): string {
  const save: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    save[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    dashboardCommand(argv);
  } finally {
    process.stdout.write = realWrite;
    renderState.useColor = true;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(save)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return chunks.join("");
}

const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
function iso(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+00:00`
  );
}
function label(d: Date): string {
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-` +
    `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}-99999`
  );
}

/** Lay down a runtime dir mid-cycle: held lock + fresh heartbeat + open start. */
function liveRuntimeDir(storyId: string, startedMinAgo: number): { rt: string; proj: string } {
  const rt = mkdtempSync(join(tmpdir(), "roll-live-rt-"));
  const nowSec = Math.floor(Date.now() / 1000);
  // inner.lock: this very (alive) test process, fresh.
  writeFileSync(join(rt, "inner.lock"), `${process.pid}:${nowSec}\n`);
  writeFileSync(join(rt, "heartbeat"), `${nowSec}\n`);
  const start = new Date(Date.now() - startedMinAgo * 60 * 1000);
  const lab = label(start);
  const events = [
    { ts: iso(start), stage: "cycle_start", label: lab, detail: "", outcome: "" },
    { ts: iso(start), stage: "pick_todo", label: lab, detail: `${storyId} picked`, outcome: "ok" },
  ];
  writeFileSync(join(rt, "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const proj = mkdtempSync(join(tmpdir(), "roll-live-proj-"));
  writeFileSync(
    join(proj, ".roll-backlog-placeholder"),
    "", // proj dir only needs .roll/backlog.md; create it next
  );
  return { rt, proj };
}

describe("FIX-203: detectLiveCycle (shared liveness verdict)", () => {
  it("reports RUNNING with story + elapsed when lock+heartbeat+open start are live", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const rt = mkdtempSync(join(tmpdir(), "roll-detect-"));
    writeFileSync(join(rt, "inner.lock"), `${process.pid}:${nowSec}\n`);
    writeFileSync(join(rt, "heartbeat"), `${nowSec}\n`);
    const start = new Date(Date.now() - 12 * 60 * 1000);
    const cycles: Cycle[] = [
      {
        label: "open",
        start,
        end: null,
        outcome: "running",
        story: "FIX-199",
        pr: null,
        fail_detail: null,
      },
    ];
    const live = detectLiveCycle(rt, cycles, new Date());
    expect(live.running).toBe(true);
    expect(live.story).toBe("FIX-199");
    expect(live.elapsedSec).toBeGreaterThanOrEqual(11 * 60);
  });

  it("reports not-running when there is no inner.lock", () => {
    const rt = mkdtempSync(join(tmpdir(), "roll-detect-nolock-"));
    const live = detectLiveCycle(rt, [], new Date());
    expect(live.running).toBe(false);
  });

  it("reports not-running when the heartbeat is stale", () => {
    const rt = mkdtempSync(join(tmpdir(), "roll-detect-stale-"));
    const nowSec = Math.floor(Date.now() / 1000);
    writeFileSync(join(rt, "inner.lock"), `${process.pid}:${nowSec}\n`);
    writeFileSync(join(rt, "heartbeat"), `${nowSec - 4000}\n`); // > 1800s → dead
    const cycles: Cycle[] = [
      { label: "o", start: new Date(), end: null, outcome: "running", story: "X", pr: null, fail_detail: null },
    ];
    expect(detectLiveCycle(rt, cycles, new Date()).running).toBe(false);
  });

  it("reports not-running when the lock pid is dead", () => {
    const rt = mkdtempSync(join(tmpdir(), "roll-detect-deadpid-"));
    const nowSec = Math.floor(Date.now() / 1000);
    writeFileSync(join(rt, "inner.lock"), `999999:${nowSec}\n`);
    writeFileSync(join(rt, "heartbeat"), `${nowSec}\n`);
    const cycles: Cycle[] = [
      { label: "o", start: new Date(), end: null, outcome: "running", story: "X", pr: null, fail_detail: null },
    ];
    // inject a pidAlive that says 999999 is dead.
    expect(detectLiveCycle(rt, cycles, new Date(), () => false).running).toBe(false);
  });
});

describe("FIX-203: dashboard eyebrow surfaces the live cycle", () => {
  it("shows RUNNING + story + elapsed (no state.yaml present)", () => {
    const { rt, proj } = liveRuntimeDir("FIX-199", 12);
    // backlog so the story title resolves.
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(
      join(proj, ".roll", "backlog.md"),
      ["| ID | Description | Status |", "|----|----|----|", "| FIX-199 | changelog drift | In Progress |", ""].join(
        "\n",
      ),
    );
    const home = mkdtempSync(join(tmpdir(), "roll-live-home-"));
    const shared = mkdtempSync(join(tmpdir(), "roll-live-shared-"));
    const out = tsRun(
      {
        HOME: home,
        ROLL_PROJECT_RUNTIME_DIR: rt,
        ROLL_SHARED_ROOT: shared,
        ROLL_MAIN_SLUG: "test-live01",
        _LAUNCHD_DIR: join(home, "la"),
      },
      ["--no-color", "--en"],
      proj,
    );
    expect(out).toContain("RUNNING");
    expect(out).toContain("FIX-199");
    expect(out).toContain("elapsed");
  });
});
