import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cycleWasScreenLocked, screenLockWaitReason } from "../src/runner/screen-lock-events.js";

function ledger(events: readonly Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-screen-lock-"));
  const path = join(dir, "events.ndjson");
  writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return path;
}

describe("FIX-1268b — screen-lock wait event projection", () => {
  it("renders a single-language wait reason only while the latest lock state is locked", () => {
    const locked = ledger([
      { type: "loop:screen_locked", cycleId: "lock-1", locked: true, reason: "console locked", ts: 1 },
    ]);
    expect(screenLockWaitReason(locked, "en")).toBe("waiting for screen unlock");
    expect(screenLockWaitReason(locked, "zh")).toBe("等待屏幕解锁");

    const unlocked = ledger([
      { type: "loop:screen_locked", cycleId: "lock-1", locked: true, reason: "console locked", ts: 1 },
      { type: "loop:screen_locked", cycleId: "unlock-1", locked: false, reason: "console unlocked", ts: 2 },
    ]);
    expect(screenLockWaitReason(unlocked, "en")).toBeNull();
    expect(screenLockWaitReason(unlocked, "zh")).toBeNull();
  });

  it("attributes the wait exemption only to the cycle that recorded a locked event", () => {
    const path = ledger([
      { type: "loop:screen_locked", cycleId: "locked-cycle", locked: true, reason: "console locked", ts: 1 },
      { type: "loop:screen_locked", cycleId: "unlocked-cycle", locked: false, reason: "console unlocked", ts: 2 },
    ]);
    expect(cycleWasScreenLocked(path, "locked-cycle")).toBe(true);
    expect(cycleWasScreenLocked(path, "unlocked-cycle")).toBe(false);
    expect(cycleWasScreenLocked(path, "other-cycle")).toBe(false);
  });
});
