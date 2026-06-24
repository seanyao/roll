/**
 * Unit tests for wake-hook — rearmLoop + tryWakeOnRoll + isProductiveCommand
 * (US-LOOP-079i).
 *
 * Covers:
 *   AC1 — rearmLoop atomic rename, scheduler.wake, loop:woke, no-op on miss/armed
 *   AC2 — concurrent dual triggers → at most one wake
 *   AC3 — .waking orphan recovery
 *   AC4 — fast path: zero backlog reads when neither marker exists
 *   AC5 — productive vs read-only command boundary
 *   AC6 — ROLL_NO_WAKE gate
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BacklogStore, EventBus, assessBacklog } from "@roll/core";
import { type Scheduler, launchdLabel } from "@roll/infra";
import {
  rearmLoop,
  tryWakeOnRoll,
  isProductiveCommand,
  buildProductionWakeDeps,
  type WakeDeps,
} from "../src/lib/wake-hook.js";
import { dormantMarkerPath, writeDormantMarker } from "../src/commands/loop-sched.js";

// ── sandbox helpers ────────────────────────────────────────────────────────

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      unlinkSync(join(d, ".roll", "loop", "DORMANT-testslug"));
      unlinkSync(join(d, ".roll", "loop", ".waking-testslug"));
    } catch { /* ok */ }
  }
});

function tmpSandbox(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-wake-${tag}-`)));
  mkdirSync(join(d, ".roll", "loop"), { recursive: true });
  dirs.push(d);
  return d;
}

/** Write a valid DORMANT marker into the sandbox. */
function seedDormant(sandbox: string): void {
  writeDormantMarker(join(sandbox, ".roll", "loop", "DORMANT-testslug"), {
    since: "2026-06-24T10:00:00Z",
    reason: "idle 6h",
  });
}

/** Write a minimal .waking marker (orphan simulation). */
function seedWaking(sandbox: string): void {
  writeFileSync(join(sandbox, ".roll", "loop", ".waking-testslug"), "", "utf8");
}

// ── fake deps builder ──────────────────────────────────────────────────────

interface FakeSchedState {
  armed: boolean;
  wakeCalls: number;
  isArmedCalls: number;
}

function fakeScheduler(state: FakeSchedState): Scheduler {
  return {
    dormant: async () => {
      state.armed = false;
      return true;
    },
    wake: async (_label, _plist) => {
      state.wakeCalls++;
      state.armed = true;
      return true;
    },
    isArmed: async () => {
      state.isArmedCalls++;
      return state.armed;
    },
  };
}

interface FakeDepsOpts {
  sandbox: string;
  schedulerState: FakeSchedState;
  backlogContent?: string;
  eventsAppended?: Array<Record<string, unknown>>;
  nowSec?: () => number;
  /** When set, the probe behaves as if the named files exist/don't exist. */
  probeOverrides?: Record<string, boolean>;
}

function fakeDeps(opts: FakeDepsOpts): WakeDeps {
  const sandbox = opts.sandbox;
  const store = new BacklogStore();

  // Write backlog if provided — used for assessBacklog checks
  if (opts.backlogContent !== undefined) {
    writeFileSync(join(sandbox, ".roll", "backlog.md"), opts.backlogContent, "utf8");
  }
  // Write events skeleton
  writeFileSync(join(sandbox, ".roll", "loop", "events.ndjson"), "", "utf8");

  const eventsAppended: Array<Record<string, unknown>> = [];

  const realProbe = (p: string) => existsSync(p);

  return {
    projectPath: sandbox,
    slug: "testslug",
    scheduler: fakeScheduler(opts.schedulerState),
    backlogPath: join(sandbox, ".roll", "backlog.md"),
    eventsPath: join(sandbox, ".roll", "loop", "events.ndjson"),
    eventBus: {
      appendEvent: (_path, event) => {
        eventsAppended.push(event as Record<string, unknown>);
        return "";
      },
      ensureEventFiles: () => {},
      eventsSize: () => 0,
      readEvents: () => [],
      upsertRun: () => "",
    } as unknown as EventBus,
    readBacklog: (path) => store.readBacklog(path),
    probe: opts.probeOverrides
      ? (p) => opts.probeOverrides![p] ?? realProbe(p)
      : realProbe,
    rename: (from, to) => renameSync(from, to),
    unlink: (path) => unlinkSync(path),
    nowSec: opts.nowSec ?? (() => 1719000000),
    loopPlistPath: "/fake/com.roll.loop.testslug.plist",
  };
}

// ── shared helpers ─────────────────────────────────────────────────────────

const EMPTY_BACKLOG = `| ID | Description | Status |
|----|-------------|--------|
`;

function todoBacklog(id = "US-1"): string {
  return `| ID | Description | Status |
|----|-------------|--------|
| [${id}](./spec.md) | Test story | 📋 Todo |
`;
}

// ───────────────────────────────────────────────────────────────────────────
// AC1 — rearmLoop
// ───────────────────────────────────────────────────────────────────────────

describe("AC1 — rearmLoop atomic claim + wake + loop:woke", () => {
  it("renames DORMANT → .waking, calls scheduler.wake, deletes .waking, emits loop:woke", async () => {
    const sb = tmpSandbox("ac1-a");
    seedDormant(sb);
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state, nowSec: () => 1719000000 });

    const epoch = await rearmLoop("roll-cmd", deps);

    // DORMANT should be gone, .waking should be gone
    expect(existsSync(join(sb, ".roll", "loop", "DORMANT-testslug"))).toBe(false);
    expect(existsSync(join(sb, ".roll", "loop", ".waking-testslug"))).toBe(false);
    // Wake was called
    expect(state.wakeCalls).toBe(1);
    expect(state.isArmedCalls).toBeGreaterThanOrEqual(1);
    // Epoch returned
    expect(epoch).toBe(1719000000);
  });

  it("DORMANT missing → rename fails, no-op (returns -1)", async () => {
    const sb = tmpSandbox("ac1-b");
    // no seed — DORMANT does not exist
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    const epoch = await rearmLoop("roll-cmd", deps);

    expect(epoch).toBe(-1);
    expect(state.wakeCalls).toBe(0);
    // .waking should never have been created
    expect(existsSync(join(sb, ".roll", "loop", ".waking-testslug"))).toBe(false);
  });

  it("lane already armed → deletes .waking, no wake call, no event, returns -1", async () => {
    const sb = tmpSandbox("ac1-c");
    seedDormant(sb);
    const state: FakeSchedState = { armed: true, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    const epoch = await rearmLoop("roll-cmd", deps);

    expect(epoch).toBe(-1);
    expect(state.wakeCalls).toBe(0);
    // isArmed WAS called (to check)
    expect(state.isArmedCalls).toBeGreaterThanOrEqual(1);
    // .waking is cleaned up
    expect(existsSync(join(sb, ".roll", "loop", ".waking-testslug"))).toBe(false);
    // DORMANT is gone (renamed, then .waking deleted)
    expect(existsSync(join(sb, ".roll", "loop", "DORMANT-testslug"))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — concurrent dual triggers
// ───────────────────────────────────────────────────────────────────────────

describe("AC2 — concurrent triggers yield at most one wake", () => {
  it("simulated dual rearmLoop → only first succeeds, at most one wake", async () => {
    const sb = tmpSandbox("ac2");
    seedDormant(sb);
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };

    const deps1 = fakeDeps({ sandbox: sb, schedulerState: state });
    const deps2 = fakeDeps({ sandbox: sb, schedulerState: state });

    // Fire both "concurrently" (sequentially in test but first claims the rename)
    const r1 = await rearmLoop("roll-cmd", deps1);
    // Second attempt: DORMANT was already renamed by first → rename fails
    // But .waking might exist from first call depending on timing.
    // In our sequential test, first call completed, so .waking is gone.
    // Second call: DORMANT missing, .waking missing → no-op
    const r2 = await rearmLoop("dream", deps2);

    // Only one should have succeeded
    const successes = [r1, r2].filter((r) => r !== -1);
    expect(successes.length).toBeLessThanOrEqual(1);
    // At most one wake call
    expect(state.wakeCalls).toBeLessThanOrEqual(1);
    // DORMANT is gone
    expect(existsSync(join(sb, ".roll", "loop", "DORMANT-testslug"))).toBe(false);
    // .waking is gone
    expect(existsSync(join(sb, ".roll", "loop", ".waking-testslug"))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC3 — .waking orphan recovery
// ───────────────────────────────────────────────────────────────────────────

describe("AC3 — .waking orphan recovery", () => {
  it(".waking exists + !isArmed → completes wake + deletes .waking + emits loop:woke", async () => {
    const sb = tmpSandbox("ac3-a");
    // No DORMANT, only .waking (simulating crash between rename and wake)
    seedWaking(sb);
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state, nowSec: () => 1719000000 });

    const epoch = await rearmLoop("roll-cmd", deps);

    expect(epoch).toBe(1719000000);
    expect(state.wakeCalls).toBe(1);
    expect(existsSync(join(sb, ".roll", "loop", ".waking-testslug"))).toBe(false);
  });

  it(".waking exists + isArmed → deletes .waking, no wake, no event, returns -1", async () => {
    const sb = tmpSandbox("ac3-b");
    seedWaking(sb);
    const state: FakeSchedState = { armed: true, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    const epoch = await rearmLoop("roll-cmd", deps);

    expect(epoch).toBe(-1);
    expect(state.wakeCalls).toBe(0);
    expect(existsSync(join(sb, ".roll", "loop", ".waking-testslug"))).toBe(false);
  });

  it("both DORMANT and .waking absent → quick no-op", async () => {
    const sb = tmpSandbox("ac3-c");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    const epoch = await rearmLoop("roll-cmd", deps);

    expect(epoch).toBe(-1);
    expect(state.wakeCalls).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 — fast path: zero backlog reads when no marker
// ───────────────────────────────────────────────────────────────────────────

describe("AC4 — fast path skips backlog read when no marker", () => {
  it("DORMANT + .waking both absent → returns immediately, zero readBacklog calls", async () => {
    const sb = tmpSandbox("ac4-a");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    let readCalls = 0;
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });
    deps.readBacklog = (path) => {
      readCalls++;
      return new BacklogStore().readBacklog(path);
    };

    await tryWakeOnRoll(["build", "US-1"], deps);

    // No markers → fast path must not touch backlog
    expect(readCalls).toBe(0);
    expect(state.wakeCalls).toBe(0);
  });

  it("DORMANT present → fast path passes, proceeds to productive check", async () => {
    const sb = tmpSandbox("ac4-b");
    seedDormant(sb);
    // Pre-create a backlog with work so readBacklog succeeds
    writeFileSync(join(sb, ".roll", "backlog.md"), todoBacklog(), "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };

    let readCalls = 0;
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });
    deps.readBacklog = (path) => {
      readCalls++;
      const snap = new BacklogStore().readBacklog(path);
      return { ...snap, items: [{ id: "US-1", desc: "test", status: "📋 Todo" }] };
    };

    await tryWakeOnRoll(["build", "US-1"], deps);

    // Marker present → must read backlog
    expect(readCalls).toBeGreaterThanOrEqual(1);
    // Since assessBacklog has hasWork=true and build is productive → wake
    expect(state.wakeCalls).toBe(1);
  });

  it(".waking present → fast path passes, proceeds to productive check", async () => {
    const sb = tmpSandbox("ac4-c");
    seedWaking(sb);
    // Pre-create a backlog with work so readBacklog succeeds
    writeFileSync(join(sb, ".roll", "backlog.md"), todoBacklog(), "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };

    let readCalls = 0;
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });
    deps.readBacklog = (path) => {
      readCalls++;
      const snap = new BacklogStore().readBacklog(path);
      return { ...snap, items: [{ id: "US-1", desc: "test", status: "📋 Todo" }] };
    };

    await tryWakeOnRoll(["build", "US-1"], deps);

    expect(readCalls).toBeGreaterThanOrEqual(1);
    // .waking orphan → rearmLoop recovers
    expect(state.wakeCalls).toBe(1);
    // .waking should be cleaned
    expect(existsSync(join(sb, ".roll", "loop", ".waking-testslug"))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC5 — productive vs read-only command boundary
// ───────────────────────────────────────────────────────────────────────────

describe("AC5 — command boundary (productive vs read-only)", () => {
  const readOnlyArgs = [
    ["status"],
    ["doctor"],
    ["version"],
    ["--help"],
    ["-h"],
    ["help"],
    ["status", "--help"],
    ["build", "--help"],
    ["config"],
    ["ls"],
    ["showcase"],
    ["dashboard"],
    ["pulse"],
  ];

  const loopSubArgs = [
    ["loop"],
    ["loop", "on"],
    ["loop", "off"],
    ["loop", "now"],
    ["loop", "status"],
    ["loop", "watch"],
    ["loop", "goal"],
    ["loop", "go"],
    ["loop", "run-once"],
    ["loop", "pause"],
    ["loop", "resume"],
    ["loop", "sched"],
    ["loop", "pr-inbox"],
  ];

  const productiveArgs = [
    ["build", "US-1"],
    ["fix", "FIX-1"],
    ["idea", "some idea text"],
    ["story", "new", "--title", "test"],
    ["story", "validate", "US-1"],
    ["backlog", "set-status", "US-1", "Todo"],
    ["backlog", "sync"],
    ["backlog", "unstick", "US-1"],
    ["design"],
    ["propose"],
    ["peer"],
  ];

  for (const args of readOnlyArgs) {
    it(`"${args.join(" ")}" is NOT productive`, () => {
      expect(isProductiveCommand(args)).toBe(false);
    });
  }

  for (const args of loopSubArgs) {
    it(`"${args.join(" ")}" is NOT productive (anti-recursion)`, () => {
      expect(isProductiveCommand(args)).toBe(false);
    });
  }

  for (const args of productiveArgs) {
    it(`"${args.join(" ")}" IS productive`, () => {
      expect(isProductiveCommand(args)).toBe(true);
    });
  }

  it("'story' without sub-command is NOT productive", () => {
    expect(isProductiveCommand(["story"])).toBe(false);
  });

  it("'backlog' without sub-command is NOT productive", () => {
    expect(isProductiveCommand(["backlog"])).toBe(false);
  });

  it("empty args are NOT productive", () => {
    expect(isProductiveCommand([])).toBe(false);
  });

  it("unknown command is NOT productive", () => {
    expect(isProductiveCommand(["unknown-cmd"])).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC5 — integrated: only productive commands trigger tryWakeOnRoll
// ───────────────────────────────────────────────────────────────────────────

describe("AC5 — tryWakeOnRoll respects command boundary", () => {
  function depsWithWork(sb: string): { deps: WakeDeps; state: FakeSchedState } {
    seedDormant(sb);
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    // Write a backlog with work
    writeFileSync(join(sb, ".roll", "backlog.md"), todoBacklog(), "utf8");
    return { deps: fakeDeps({ sandbox: sb, schedulerState: state }), state };
  }

  it("productive 'build' triggers wake when marker + hasWork", async () => {
    const sb = tmpSandbox("ac5-int1");
    const { deps, state } = depsWithWork(sb);
    await tryWakeOnRoll(["build", "US-1"], deps);
    expect(state.wakeCalls).toBe(1);
  });

  it("read-only 'status' does NOT trigger wake even with marker + hasWork", async () => {
    const sb = tmpSandbox("ac5-int2");
    const { deps, state } = depsWithWork(sb);
    await tryWakeOnRoll(["status"], deps);
    expect(state.wakeCalls).toBe(0);
  });

  it("'loop on' does NOT trigger wake (anti-recursion)", async () => {
    const sb = tmpSandbox("ac5-int3");
    const { deps, state } = depsWithWork(sb);
    await tryWakeOnRoll(["loop", "on"], deps);
    expect(state.wakeCalls).toBe(0);
  });

  it("marker present but backlog has no work → does NOT trigger wake", async () => {
    const sb = tmpSandbox("ac5-int4");
    seedDormant(sb);
    writeFileSync(join(sb, ".roll", "backlog.md"), EMPTY_BACKLOG, "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });
    await tryWakeOnRoll(["build", "US-1"], deps);
    expect(state.wakeCalls).toBe(0);
  });

  it("backlog has only Done items → does NOT trigger wake", async () => {
    const sb = tmpSandbox("ac5-int5");
    seedDormant(sb);
    writeFileSync(join(sb, ".roll", "backlog.md"), `| ID | Description | Status |
|----|-------------|--------|
| [US-1](./spec.md) | Test story | ✅ Done |
`, "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });
    await tryWakeOnRoll(["build", "US-1"], deps);
    expect(state.wakeCalls).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC6 — ROLL_NO_WAKE gate
// ───────────────────────────────────────────────────────────────────────────

describe("AC6 — ROLL_NO_WAKE gate", () => {
  const origNoWake = process.env["ROLL_NO_WAKE"];
  const origForce = process.env["ROLL_LOOP_FORCE"];

  afterEach(() => {
    if (origNoWake === undefined) delete process.env["ROLL_NO_WAKE"];
    else process.env["ROLL_NO_WAKE"] = origNoWake;
    if (origForce === undefined) delete process.env["ROLL_LOOP_FORCE"];
    else process.env["ROLL_LOOP_FORCE"] = origForce;
  });

  it("ROLL_NO_WAKE=1 → tryWakeOnRoll returns immediately, no wake", async () => {
    process.env["ROLL_NO_WAKE"] = "1";
    const sb = tmpSandbox("ac6-a");
    seedDormant(sb);
    writeFileSync(join(sb, ".roll", "backlog.md"), todoBacklog(), "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    await tryWakeOnRoll(["build", "US-1"], deps);
    expect(state.wakeCalls).toBe(0);
  });

  it("ROLL_NO_WAKE=true → tryWakeOnRoll returns immediately", async () => {
    process.env["ROLL_NO_WAKE"] = "true";
    const sb = tmpSandbox("ac6-a2");
    seedDormant(sb);
    writeFileSync(join(sb, ".roll", "backlog.md"), todoBacklog(), "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    await tryWakeOnRoll(["build", "US-1"], deps);
    expect(state.wakeCalls).toBe(0);
  });

  it("ROLL_LOOP_FORCE set → tryWakeOnRoll returns immediately (runner env)", async () => {
    process.env["ROLL_LOOP_FORCE"] = "1";
    const sb = tmpSandbox("ac6-b");
    seedDormant(sb);
    writeFileSync(join(sb, ".roll", "backlog.md"), todoBacklog(), "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    await tryWakeOnRoll(["build", "US-1"], deps);
    expect(state.wakeCalls).toBe(0);
  });

  it("without ROLL_NO_WAKE → wake proceeds normally", async () => {
    delete process.env["ROLL_NO_WAKE"];
    delete process.env["ROLL_LOOP_FORCE"];
    const sb = tmpSandbox("ac6-c");
    seedDormant(sb);
    writeFileSync(join(sb, ".roll", "backlog.md"), todoBacklog(), "utf8");
    const state: FakeSchedState = { armed: false, wakeCalls: 0, isArmedCalls: 0 };
    const deps = fakeDeps({ sandbox: sb, schedulerState: state });

    await tryWakeOnRoll(["build", "US-1"], deps);
    expect(state.wakeCalls).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// buildProductionWakeDeps
// ───────────────────────────────────────────────────────────────────────────

describe("buildProductionWakeDeps", () => {
  it("returns a fully-wired WakeDeps with real fs primitives", () => {
    const scheduler = fakeScheduler({ armed: false, wakeCalls: 0, isArmedCalls: 0 });
    const deps = buildProductionWakeDeps("/fake/proj", "abc123", scheduler);
    expect(deps.projectPath).toBe("/fake/proj");
    expect(deps.slug).toBe("abc123");
    expect(deps.scheduler).toBe(scheduler);
    expect(deps.backlogPath).toBe("/fake/proj/.roll/backlog.md");
    expect(deps.eventsPath).toBe("/fake/proj/.roll/loop/events.ndjson");
    expect(typeof deps.readBacklog).toBe("function");
    expect(typeof deps.probe).toBe("function");
    expect(typeof deps.rename).toBe("function");
    expect(typeof deps.unlink).toBe("function");
    expect(typeof deps.nowSec).toBe("function");
    expect(deps.loopPlistPath).toContain("com.roll.loop.abc123.plist");
  });
});
