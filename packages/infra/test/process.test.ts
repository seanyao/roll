/**
 * Tests for the ProcessManager — lock acquire/conflict/stale-takeover,
 * heartbeat age + verdicts with an injected clock, and the exit-hook
 * unconditional-final-write discipline driven by a real SIGTERM'd child.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acquireLock,
  formatLock,
  heartbeatAge,
  INNER_LOCK_STALE_SEC,
  isLockHeld,
  livenessVerdict,
  OUTER_LOCK_STALE_SEC,
  parseLock,
  releaseLock,
  writeHeartbeat,
} from "../src/index.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-infra-proc-"));
  dirs.push(d);
  return d;
}
/** Spawn a node child that exits immediately; return its (now-dead) pid. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  // r.pid is the child's pid; it has exited by the time spawnSync returns.
  return r.pid ?? 999999999;
}

describe("lock parse/format", () => {
  it("round-trips pid:ts", () => {
    expect(parseLock(formatLock(123, 456))).toEqual({ pid: 123, ts: 456 });
  });
  it("only the first line is consulted; junk → undefined fields", () => {
    expect(parseLock("789:111\nextra")).toEqual({ pid: 789, ts: 111 });
    expect(parseLock("garbage")).toEqual({ pid: undefined, ts: undefined });
    expect(parseLock("12:")).toEqual({ pid: 12, ts: undefined });
  });
});

describe("isLockHeld", () => {
  const liveAlways = () => true;
  it("held when pid alive and within the age threshold", () => {
    expect(isLockHeld({ pid: 1, ts: 100 }, 200, OUTER_LOCK_STALE_SEC, liveAlways)).toBe(true);
  });
  it("stale when age >= threshold (even if pid alive)", () => {
    expect(isLockHeld({ pid: 1, ts: 0 }, OUTER_LOCK_STALE_SEC, OUTER_LOCK_STALE_SEC, liveAlways)).toBe(false);
    expect(isLockHeld({ pid: 1, ts: 0 }, OUTER_LOCK_STALE_SEC - 1, OUTER_LOCK_STALE_SEC, liveAlways)).toBe(true);
  });
  it("stale when pid dead (even if fresh)", () => {
    expect(isLockHeld({ pid: 1, ts: 999 }, 1000, OUTER_LOCK_STALE_SEC, () => false)).toBe(false);
  });
  it("unparseable contents → not held", () => {
    expect(isLockHeld({ pid: undefined, ts: undefined }, 0, OUTER_LOCK_STALE_SEC, liveAlways)).toBe(false);
  });
});

describe("acquireLock", () => {
  it("acquires a fresh lock and writes pid:ts", () => {
    const d = tmp();
    const lock = join(d, "loop", ".lock");
    const r = acquireLock(lock, 4242, { now: () => 1000 });
    expect(r.acquired).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe("4242:1000\n");
  });

  it("conflict: a live, fresh lock is NOT taken over", () => {
    const d = tmp();
    const lock = join(d, ".lock");
    writeFileSync(lock, formatLock(process.pid, 1000), "utf8"); // our own pid = alive
    const r = acquireLock(lock, 7777, { now: () => 1100, staleSec: OUTER_LOCK_STALE_SEC });
    expect(r.acquired).toBe(false);
    expect(r.heldByPid).toBe(process.pid);
    // untouched
    expect(readFileSync(lock, "utf8")).toBe(formatLock(process.pid, 1000));
  });

  it("stale-takeover: a dead pid's lock is removed and re-acquired", () => {
    const d = tmp();
    const lock = join(d, ".lock");
    writeFileSync(lock, formatLock(deadPid(), 1000), "utf8");
    const r = acquireLock(lock, 5555, { now: () => 1050 });
    expect(r.acquired).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe("5555:1050\n");
  });

  it("stale-takeover: an aged lock (>= threshold) is taken over even if pid alive", () => {
    const d = tmp();
    const lock = join(d, ".lock");
    writeFileSync(lock, formatLock(process.pid, 0), "utf8");
    const r = acquireLock(lock, 6666, { now: () => OUTER_LOCK_STALE_SEC, staleSec: OUTER_LOCK_STALE_SEC });
    expect(r.acquired).toBe(true);
  });

  it("inner-lock threshold is 14400s", () => {
    expect(INNER_LOCK_STALE_SEC).toBe(14400);
    const d = tmp();
    const lock = join(d, ".lock");
    writeFileSync(lock, formatLock(process.pid, 0), "utf8");
    // age 14399 < 14400 → still held
    const held = acquireLock(lock, 1, { now: () => 14399, staleSec: INNER_LOCK_STALE_SEC });
    expect(held.acquired).toBe(false);
  });

  it("releaseLock removes the file idempotently", () => {
    const d = tmp();
    const lock = join(d, ".lock");
    acquireLock(lock, 1, { now: () => 1 });
    expect(existsSync(lock)).toBe(true);
    releaseLock(lock);
    expect(existsSync(lock)).toBe(false);
    releaseLock(lock); // no throw on absent
  });
});

describe("heartbeat", () => {
  it("writeHeartbeat writes the epoch second as content", () => {
    const d = tmp();
    const hb = join(d, ".heartbeat");
    writeHeartbeat(hb, () => 1700000000);
    expect(readFileSync(hb, "utf8")).toBe("1700000000\n");
  });

  it("heartbeatAge = now - content; missing/garbage → ts 0", () => {
    const d = tmp();
    const hb = join(d, ".heartbeat");
    writeHeartbeat(hb, () => 1000);
    expect(heartbeatAge(hb, () => 1050)).toBe(50);
    expect(heartbeatAge(join(d, "missing"), () => 1050)).toBe(1050); // ts=0
    writeFileSync(hb, "not-a-number\n");
    expect(heartbeatAge(hb, () => 1050)).toBe(1050); // ts=0
  });

  it("livenessVerdict: alive iff age < timeout (default 1800)", () => {
    const d = tmp();
    const hb = join(d, ".heartbeat");
    writeHeartbeat(hb, () => 1000);
    expect(livenessVerdict(hb, { now: () => 1000 + 1799 })).toEqual({ alive: true, ageSec: 1799 });
    expect(livenessVerdict(hb, { now: () => 1000 + 1800 })).toEqual({ alive: false, ageSec: 1800 });
    expect(livenessVerdict(hb, { now: () => 1000 + 100, timeoutSec: 60 })).toEqual({ alive: false, ageSec: 100 });
  });
});

describe("installExitHooks (S3 unconditional final write)", () => {
  it("final-state file is written when the child is SIGTERM'd", async () => {
    const d = tmp();
    const out = join(d, "final.txt");
    const childScript = join(d, "child.mjs");
    // The child installs the exit hooks via the BUILT infra dist, sets up a
    // start signal (writes 'started'), then idles. On SIGTERM the hook MUST
    // write the terminal file before the process dies (mirrors _inner_cleanup
    // firing on the EXIT trap after the TERM handler).
    const infraDist = join(process.cwd(), "dist", "index.js");
    writeFileSync(
      childScript,
      [
        `import { installExitHooks } from ${JSON.stringify(infraDist)};`,
        `import { writeFileSync } from "node:fs";`,
        `installExitHooks(() => writeFileSync(${JSON.stringify(out)}, "final\\n"));`,
        `process.stdout.write("ready\\n");`,
        `setInterval(() => {}, 1000);`,
      ].join("\n"),
      "utf8",
    );

    await new Promise<void>((resolveDone, reject) => {
      const child = spawn(process.execPath, [childScript], { stdio: ["ignore", "pipe", "inherit"] });
      let killed = false;
      child.stdout.on("data", (b: Buffer) => {
        if (!killed && b.toString().includes("ready")) {
          killed = true;
          child.kill("SIGTERM");
        }
      });
      child.on("exit", () => resolveDone());
      child.on("error", reject);
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        reject(new Error("child did not exit in time"));
      }, 8000).unref();
    });

    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf8")).toBe("final\n");
  });

  it("final runs exactly once on normal exit", async () => {
    const d = tmp();
    const out = join(d, "count.txt");
    const childScript = join(d, "child-normal.mjs");
    const infraDist = join(process.cwd(), "dist", "index.js");
    writeFileSync(
      childScript,
      [
        `import { installExitHooks } from ${JSON.stringify(infraDist)};`,
        `import { appendFileSync } from "node:fs";`,
        `installExitHooks(() => appendFileSync(${JSON.stringify(out)}, "x"));`,
        `process.exit(0);`,
      ].join("\n"),
      "utf8",
    );
    const r = spawnSync(process.execPath, [childScript]);
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("x");
  });
});
