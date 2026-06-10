/**
 * FIX-233 / FIX-237 / FIX-245 — the loop-observability trio.
 *
 * 233: the pr loop dead-ticked gh_error 345 times over four silent days
 *      (launchctl proxy poison) — a streak must alert, recovery must note.
 * 237: `roll loop now`'s observation window replayed the PREVIOUS cycle's
 *      transcript (stale live.log) — two misled debug sessions.
 * 245: an agent opened its own PR inside the cycle (PR #578) — the runner now
 *      adopts the registration and logs the discipline breach.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { deadTickVerdict, prIdleTick, prInboxGate } from "@roll/core";
import { checkDeadTickStreak } from "../src/commands/loop-pr-inbox.js";
import { resetLiveLog } from "../src/commands/loop-run-once.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});
function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-trio-${tag}-`)));
  dirs.push(d);
  return d;
}

describe("FIX-233 — dead-tick streak alerting", () => {
  it("AC2: a failed gh list carries its stderr first line into the tick", () => {
    const tick = prInboxGate({
      ghAvailable: true,
      listOk: false,
      listStdout: "",
      openCount: 0,
      listStderr: "error connecting to api.github.com: proxyconnect tcp 127.0.0.1:7897 refused\nmore noise",
    });
    expect(tick).toMatchObject({ note: "gh_error" });
    expect(tick?.detail).toContain("proxyconnect");
    expect(tick?.detail).not.toContain("more noise"); // first line only
  });

  it("AC2: prIdleTick truncates detail to 200 chars", () => {
    const t = prIdleTick("gh_error", "x".repeat(500));
    expect(t.detail?.length).toBe(200);
  });

  it("AC1 verdicts: 5 consecutive abnormal → alert; healthy after alert → recovered", () => {
    expect(deadTickVerdict({ recentNotes: ["gh_error", "gh_error", "gh_error", "gh_error", "gh_error"], alreadyAlerted: false })).toBe("alert");
    expect(deadTickVerdict({ recentNotes: ["no_open_prs", "gh_error", "gh_error"], alreadyAlerted: false })).toBeNull();
    expect(deadTickVerdict({ recentNotes: ["gh_error", "no_open_prs"], alreadyAlerted: true })).toBe("recovered");
    expect(deadTickVerdict({ recentNotes: ["gh_error"], alreadyAlerted: true })).toBeNull(); // still dead — one alert per streak
  });

  it("AC3 end-to-end: fabricated tick file → ALERT with first/last ts + count; recovery notes and clears the marker", () => {
    const d = tmp("ticks");
    const file = join(d, "pr-tick.jsonl");
    const marker = join(d, ".marker");
    const rows = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ ts: `2026-06-11T0${i}:00:00Z`, loop: "pr", outcome: "idle", note: "gh_error" }),
    );
    writeFileSync(file, rows.join("\n") + "\n");
    const alerts: string[] = [];
    checkDeadTickStreak(file, (l) => alerts.push(l), marker);
    expect(alerts[0]).toContain("5 consecutive");
    expect(alerts[0]).toContain("2026-06-11T00:00:00Z");
    expect(alerts[0]).toContain("2026-06-11T04:00:00Z");
    expect(existsSync(marker)).toBe(true);
    // same streak continues → no duplicate alert
    writeFileSync(file, rows.join("\n") + "\n" + JSON.stringify({ ts: "t6", note: "gh_error" }) + "\n");
    checkDeadTickStreak(file, (l) => alerts.push(l), marker);
    expect(alerts).toHaveLength(1);
    // recovery → note + marker cleared
    writeFileSync(file, rows.join("\n") + "\n" + JSON.stringify({ ts: "t7", note: "no_open_prs" }) + "\n");
    checkDeadTickStreak(file, (l) => alerts.push(l), marker);
    expect(alerts[1]).toContain("recovered");
    expect(existsSync(marker)).toBe(false);
  });
});

describe("FIX-237 — the observation window never replays the previous cycle", () => {
  it("AC1/AC2: prefilled stale live.log is truncated to this cycle's header", () => {
    const rt = tmp("rt");
    writeFileSync(join(rt, "live.log"), "OLD transcript from cycle 20260610-OLD-1\nstale lines\n");
    resetLiveLog(rt, "20260611-NEW-2");
    const log = readFileSync(join(rt, "live.log"), "utf8");
    expect(log).toContain("=== cycle 20260611-NEW-2 ===");
    expect(log).not.toContain("20260610-OLD-1");
  });
});
