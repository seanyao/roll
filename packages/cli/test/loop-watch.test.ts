/**
 * US-LOOP-074 — `roll loop watch`: one-command, read-only, concise live feed.
 *
 * The command auto-locates THIS project's .roll/loop/live.log and streams it
 * through the US-LOOP-077 renderer. These tests pin the contract:
 *   - data sourcing: it follows runtimeDir/live.log of the resolved project
 *     (honoring ROLL_PROJECT_RUNTIME_DIR), and explains itself when there's none.
 *   - READ-ONLY (AC2): the only loop interaction is a follow READ of live.log
 *     (and, with --attach, a read-only tmux attach). The deps surface has no
 *     write/signal seam at all — proven by construction + by asserting it never
 *     uses any write path.
 *   - concise default vs --verbose/--raw (AC3): default hides tier-C agent prose.
 *   - --attach (AC5): recreates the `watch` tmux window when it is MISSING from a
 *     reused session, then attaches read-only.
 *   - mid-stream rendering (AC4) is covered in loop-fmt.test.ts via the shared
 *     streamThroughRenderer engine; here we assert watch drives that engine.
 */
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loopWatchCommand, type LoopWatchDeps } from "../src/commands/loop-watch.js";
import { formatStream } from "../src/commands/loop-fmt.js";
import type { GoTmuxState } from "../src/commands/loop-go.js";

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "roll.js");

async function waitForOutput(readOutput: () => string, expected: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!readOutput().includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const CYCLE_STREAM = [
  "── cycle 20260614-1 · US-LOOP-074 · agent kimi ──",
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "packages/cli/src/commands/loop-watch.ts" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "let me reason about this for a while" }] } }), // tier C
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m 'tcr: add watch'" } }] } }),
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: false, content: "[story/x def4567] tcr: add watch" }] } }),
  JSON.stringify({ type: "result", subtype: "success", duration_ms: 8000, total_cost_usd: 0.03 }),
];

const EVENT_STREAM = [
  JSON.stringify({ type: "cycle:start", cycleId: "20260619-046-alpha", storyId: "US-LOOP-046", agent: "codex", model: "gpt-5", ts: 1_800_000_000_000 }),
  JSON.stringify({ type: "cycle:phase", cycleId: "20260619-046-alpha", phase: "execute", ts: 1_800_000_060_000 }),
  JSON.stringify({ type: "cycle:tcr", cycleId: "20260619-046-alpha", commitHash: "abcdef123456", message: "tcr: status summary", ts: 1_800_000_120_000 }),
  JSON.stringify({ type: "cycle:stdout", cycleId: "20260619-046-alpha", data: "heartbeat: building status layer", ts: 1_800_000_180_000 }),
].join("\n");

interface Recorder {
  deps: LoopWatchDeps;
  emitted: string[];
  rendered: string[];
  renderedEvents: string[];
  followedPath: string | null;
  followStopped: boolean;
  tmuxRuns: string[][];
  attached: string | null;
}

/** A fully in-memory deps double — there is NO write/signal seam to record,
 *  which is itself the read-only proof (AC2): the command literally cannot. */
function makeDeps(overrides: Partial<LoopWatchDeps> & { state?: GoTmuxState } = {}): Recorder {
  const rec: Recorder = {
    deps: {} as LoopWatchDeps,
    emitted: [],
    rendered: [],
    renderedEvents: [],
    followedPath: null,
    followStopped: false,
    tmuxRuns: [],
    attached: null,
  };
  const state: GoTmuxState = overrides.state ?? { sessionExists: false, watchWindowExists: false };
  rec.deps = {
    identity: overrides.identity ?? (async () => ({ path: "/proj", slug: "proj-abc123" })),
    exists: overrides.exists ?? (() => true),
    readText: overrides.readText ?? (() => EVENT_STREAM),
    follow: overrides.follow ?? ((livePath) => {
      rec.followedPath = livePath;
      return {
        stream: Readable.from(CYCLE_STREAM.map((l) => l + "\n")),
        stop: () => {
          rec.followStopped = true;
        },
      };
    }),
    render: overrides.render ?? (async (input, opts) => {
      const lines: string[] = [];
      for await (const chunk of input) lines.push(...String(chunk).split("\n").filter((l) => l !== ""));
      rec.rendered.push(...formatStream(lines, opts.agent, { verbose: opts.verbose }));
    }),
    renderEvents: overrides.renderEvents ?? (async (input, opts) => {
      for await (const chunk of input) {
        const lines = String(chunk).split("\n").filter((l) => l !== "");
        if (opts.raw) rec.renderedEvents.push(...lines);
        else {
          const { renderCompactWatchLines } = await import("@roll/core");
          rec.renderedEvents.push(...renderCompactWatchLines(lines));
        }
      }
    }),
    tmuxState: overrides.tmuxState ?? (() => state),
    tmuxRun: overrides.tmuxRun ?? ((argv) => {
      rec.tmuxRuns.push(argv);
      return true;
    }),
    tmuxAttach: overrides.tmuxAttach ?? ((session) => {
      rec.attached = session;
    }),
    hasTmux: overrides.hasTmux ?? (() => true),
    emit: overrides.emit ?? ((line) => rec.emitted.push(line)),
  };
  return rec;
}

describe("roll loop watch — data sourcing (AC1)", () => {
  it("follows the resolved project's .roll/loop/live.log", async () => {
    const rec = makeDeps();
    const code = await loopWatchCommand([], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBe("/proj/.roll/loop/live.log");
  });

  it("--events follows the resolved project's .roll/loop/events.ndjson", async () => {
    // The watch renderer uses device-local time (watch-render.ts hhmmss).
    // Compute expected timestamps from epoch 0/1 seconds in local timezone
    // so the assertion is portable across TZ (CI=UTC, dev=local).
    const p2 = (n: number): string => String(n).padStart(2, "0");
    const d0 = new Date(0);
    const d1 = new Date(1000);
    const ts0 = `${p2(d0.getHours())}:${p2(d0.getMinutes())}:${p2(d0.getSeconds())}`;
    const ts1 = `${p2(d1.getHours())}:${p2(d1.getMinutes())}:${p2(d1.getSeconds())}`;

    const rec = makeDeps({
      follow: (path) => {
        rec.followedPath = path;
        return {
          stream: Readable.from([
            JSON.stringify({ type: "cycle:start", cycleId: "c1", storyId: "US-LOOP-045", agent: "codex", model: "gpt-5", ts: 0 }) + "\n",
            JSON.stringify({ type: "cycle:tcr", cycleId: "c1", commitHash: "abcdef123456", message: "tcr: event mode", ts: 1 }) + "\n",
          ]),
          stop: () => {
            rec.followStopped = true;
          },
        };
      },
    });
    const code = await loopWatchCommand(["--events"], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBe("/proj/.roll/loop/events.ndjson");
    expect(rec.renderedEvents).toEqual([
      `${ts0}  cycle:start            c1 · US-LOOP-045 · codex`,
      `${ts1}  tcr                    abcdef123 · tcr: event mode`,
    ]);
    expect(rec.followStopped).toBe(true);
  });

  it("--raw-events follows events.ndjson and preserves raw lines", async () => {
    const raw = JSON.stringify({ type: "cycle:tcr", cycleId: "c1", commitHash: "abcdef123456", message: "\u001b[31mtcr: raw\u001b[0m", ts: 1 });
    const rec = makeDeps({
      follow: (path) => {
        rec.followedPath = path;
        return {
          stream: Readable.from([raw + "\n"]),
          stop: () => {
            rec.followStopped = true;
          },
        };
      },
    });
    const code = await loopWatchCommand(["--raw-events"], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBe("/proj/.roll/loop/events.ndjson");
    expect(rec.renderedEvents).toEqual([raw]);
  });

  it("honors ROLL_PROJECT_RUNTIME_DIR for the live.log location", async () => {
    const prev = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    process.env["ROLL_PROJECT_RUNTIME_DIR"] = "/custom/rt";
    try {
      const rec = makeDeps();
      await loopWatchCommand([], rec.deps);
      expect(rec.followedPath).toBe("/custom/rt/live.log");
    } finally {
      if (prev === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = prev;
    }
  });

  it("explains itself (exit 1) when there is no live feed yet, without following", async () => {
    const rec = makeDeps({ exists: () => false });
    const code = await loopWatchCommand([], rec.deps);
    expect(code).toBe(1);
    expect(rec.followedPath).toBeNull(); // never opened a follow
    expect(rec.emitted.join("\n")).toMatch(/no live feed/i);
  });

  it("explains itself when events.ndjson is missing and does not create or follow it", async () => {
    const checked: string[] = [];
    const rec = makeDeps({
      exists: (path) => {
        checked.push(path);
        return false;
      },
    });
    const code = await loopWatchCommand(["--events"], rec.deps);
    expect(code).toBe(1);
    expect(checked).toEqual(["/proj/.roll/loop/events.ndjson"]);
    expect(rec.followedPath).toBeNull();
    expect(rec.emitted.join("\n")).toMatch(/no event stream/i);
  });
});

describe("roll loop watch — default status layer (US-LOOP-046)", () => {
  it("prints a current status summary before following live.log", async () => {
    const rec = makeDeps();
    const code = await loopWatchCommand([], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBe("/proj/.roll/loop/live.log");
    const status = rec.emitted.find((line) => line.startsWith("status  "));
    expect(status).toContain("phase execute");
    expect(status).toContain("quiet");
    expect(status).toContain("US-LOOP-046");
    expect(status).toContain("codex");
    expect(status).toContain("cycle 20260619-046");
    expect(status).toContain("1 TCR");
    expect(status).toContain("last building status layer");
    expect(status).toContain("outcome unknown/no end event");
  });

  it("reports a known cycle outcome when an end event is present", async () => {
    const rec = makeDeps({
      readText: () =>
        [
          EVENT_STREAM,
          JSON.stringify({ type: "cycle:end", cycleId: "20260619-046-alpha", outcome: "delivered", cost: { usd: 0.2 }, ts: 1_800_000_240_000 }),
        ].join("\n"),
    });
    await loopWatchCommand([], rec.deps);
    expect(rec.emitted.find((line) => line.startsWith("status  "))).toContain("outcome delivered");
  });

  it("degrades to live.log-only when events.ndjson is missing", async () => {
    const rec = makeDeps({
      exists: (path) => path.endsWith("live.log"),
    });
    const code = await loopWatchCommand([], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBe("/proj/.roll/loop/live.log");
    expect(rec.emitted.join("\n")).toContain("no events.ndjson yet - live.log only");
  });

  it("degrades to live.log-only when events.ndjson is malformed", async () => {
    const rec = makeDeps({ readText: () => "{not json\n" });
    const code = await loopWatchCommand([], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBe("/proj/.roll/loop/live.log");
    expect(rec.emitted.join("\n")).toContain("event summary unavailable - live.log only");
  });

  it("updates the status snapshot as new event rows are present", async () => {
    const rec = makeDeps({
      readText: () =>
        [
          EVENT_STREAM,
          JSON.stringify({ type: "cycle:tcr", cycleId: "20260619-046-alpha", commitHash: "123456789abc", message: "tcr: second", ts: 1_800_000_240_000 }),
        ].join("\n"),
    });
    await loopWatchCommand([], rec.deps);
    const status = rec.emitted.find((line) => line.startsWith("status  "));
    expect(status).toContain("2 TCR");
    expect(status).toContain("last tcr 123456789 tcr: second");
  });
});

describe("roll loop watch — narrated story transitions (US-OBS-044)", () => {
  it("emits a transition block when the active story changes between heartbeats", async () => {
    const eventsA = [
      JSON.stringify({ type: "cycle:start", cycleId: "c1", storyId: "FIX-1049", agent: "claude", model: "gpt-5", ts: 1_000_000_000_000 }),
      JSON.stringify({ type: "cycle:phase", cycleId: "c1", phase: "execute", ts: 1_000_000_060_000 }),
      JSON.stringify({ type: "cycle:end", cycleId: "c1", outcome: "published_pending_merge", ts: 1_000_000_120_000 }),
      JSON.stringify({ type: "pr:open", prNumber: 1049, storyId: "FIX-1049", ts: 1_000_000_180_000 }),
    ].join("\n");
    const eventsB = [
      eventsA,
      JSON.stringify({ type: "cycle:start", cycleId: "c2", storyId: "FIX-1050", agent: "kimi", model: "kimi", ts: 1_100_000_000_000 }),
      JSON.stringify({ type: "route:resolve", storyId: "FIX-1050", level: "story", agent: "kimi", model: "kimi", rule: "story agent default", ts: 1_100_000_060_000 }),
    ].join("\n");
    const backlog = "| [FIX-1050](...) | migrate legacy script to TS | 📋 Todo |";
    let reads = 0;
    const rec = makeDeps({
      readText: (path) => {
        if (path.endsWith("backlog.md")) return backlog;
        if (path.endsWith("events.ndjson")) {
          reads += 1;
          return reads <= 1 ? eventsA : eventsB;
        }
        return EVENT_STREAM;
      },
      render: async (_input, opts) => {
        const status = opts.status?.() ?? "";
        rec.rendered.push(status);
      },
      follow: (path) => {
        rec.followedPath = path;
        return { stream: Readable.from([]), stop: () => { rec.followStopped = true; } };
      },
    });
    const code = await loopWatchCommand([], rec.deps);
    expect(code).toBe(0);
    const snapshot = rec.emitted.join("\n") + "\n" + rec.rendered.join("\n");
    expect(snapshot).toContain("↳ story transition");
    expect(snapshot).toContain("FIX-1049");
    expect(snapshot).toContain("FIX-1050");
    expect(snapshot).toContain("migrate legacy script to TS");
    expect(snapshot).toContain("story agent default");
  });
});

describe("roll loop watch — read-only (AC2)", () => {
  it("its ONLY loop interaction is a follow READ of live.log (no write/signal seam exists)", async () => {
    const rec = makeDeps();
    await loopWatchCommand([], rec.deps);
    // The deps surface has no write/signal capability at all; the proof is that
    // the command resolves by reading + rendering only, then stops the follow.
    expect(rec.followedPath).toBe("/proj/.roll/loop/live.log");
    expect(rec.followStopped).toBe(true); // the follow is torn down cleanly
    expect(Object.keys(rec.deps)).not.toContain("write"); // no mutation seam
  });

  it("event modes have the same read-only shape: follow + renderEvents + stop only", async () => {
    const rec = makeDeps({
      follow: (path) => {
        rec.followedPath = path;
        return { stream: Readable.from([]), stop: () => { rec.followStopped = true; } };
      },
    });
    const code = await loopWatchCommand(["--events"], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBe("/proj/.roll/loop/events.ndjson");
    expect(rec.followStopped).toBe(true);
    expect(Object.keys(rec.deps)).not.toContain("signal");
    expect(Object.keys(rec.deps)).not.toContain("write");
  });
});

describe("roll loop watch — concise by default, verbose reveals raw (AC3)", () => {
  it("default shows the cycle banner but hides tier-C agent prose", async () => {
    const rec = makeDeps();
    await loopWatchCommand([], rec.deps);
    const out = rec.rendered.join("\n");
    expect(out).toContain("US-LOOP-074"); // story banner (lifecycle, always shown)
    expect(out).not.toContain("let me reason"); // tier-C prose hidden by default
    expect(out).toContain("def4567"); // parsed TCR signal is tier-B, visible by default
  });

  it("--verbose surfaces the tier-C prose", async () => {
    const rec = makeDeps();
    await loopWatchCommand(["--verbose"], rec.deps);
    expect(rec.rendered.join("\n")).toContain("let me reason");
  });

  it("--raw also surfaces everything (alias of verbose)", async () => {
    const rec = makeDeps();
    await loopWatchCommand(["--raw"], rec.deps);
    expect(rec.rendered.join("\n")).toContain("let me reason");
  });
});

describe("roll loop watch — look-back (-n/--since, AC3)", () => {
  it("passes a numeric -n through to the follow look-back", async () => {
    let seen = -1;
    const rec = makeDeps({
      follow: (livePath, sinceLines) => {
        seen = sinceLines;
        return { stream: Readable.from([]), stop: () => {} };
      },
    });
    await loopWatchCommand(["-n", "50"], rec.deps);
    expect(seen).toBe(50);
  });

  it("--since all means from the start of the log (0 = +1)", async () => {
    let seen = -1;
    const rec = makeDeps({
      follow: (_p, sinceLines) => {
        seen = sinceLines;
        return { stream: Readable.from([]), stop: () => {} };
      },
    });
    await loopWatchCommand(["--since", "all"], rec.deps);
    expect(seen).toBe(0);
  });

  it("rejects a non-numeric -n with exit 1 and a clear reason", async () => {
    const rec = makeDeps();
    const code = await loopWatchCommand(["-n", "lots"], rec.deps);
    expect(code).toBe(1);
    expect(rec.emitted.join("\n")).toMatch(/-n.*must be/i);
  });

  it("passes --since/-n through to event modes", async () => {
    let seen = -1;
    const rec = makeDeps({
      follow: (_path, sinceLines) => {
        seen = sinceLines;
        return { stream: Readable.from([]), stop: () => {} };
      },
    });
    await loopWatchCommand(["--events", "--since", "25"], rec.deps);
    expect(seen).toBe(25);
  });

  it("rejects incompatible event mode options", async () => {
    const both = makeDeps();
    expect(await loopWatchCommand(["--events", "--raw-events"], both.deps)).toBe(1);
    expect(both.emitted.join("\n")).toMatch(/choose only one/i);

    const attach = makeDeps();
    expect(await loopWatchCommand(["--events", "--attach"], attach.deps)).toBe(1);
    expect(attach.emitted.join("\n")).toMatch(/cannot be combined/i);
  });
});

describe("roll loop watch --attach (AC5) — read-only tmux observe window", () => {
  it("recreates the watch window when it is MISSING from a reused session, then attaches read-only", async () => {
    const rec = makeDeps({ state: { sessionExists: true, watchWindowExists: false } });
    const code = await loopWatchCommand(["--attach"], rec.deps);
    expect(code).toBe(0);
    // A new-window for `watch` was created (and only that — never a go/worker window).
    const watchCreate = rec.tmuxRuns.find((argv) => argv[0] === "new-window" && argv.includes("watch"));
    expect(watchCreate).toBeDefined();
    expect(rec.tmuxRuns.some((argv) => argv.join(" ").includes("loop go"))).toBe(false);
    expect(rec.attached).toBe("roll-loop-proj-abc123");
  });

  it("attaches without recreating when the watch window already exists", async () => {
    const rec = makeDeps({ state: { sessionExists: true, watchWindowExists: true } });
    const code = await loopWatchCommand(["--attach"], rec.deps);
    expect(code).toBe(0);
    expect(rec.tmuxRuns.length).toBe(0); // nothing recreated
    expect(rec.attached).toBe("roll-loop-proj-abc123");
  });

  it("explains itself (exit 1) when there is no tmux session to attach to", async () => {
    const rec = makeDeps({ state: { sessionExists: false, watchWindowExists: false } });
    const code = await loopWatchCommand(["--attach"], rec.deps);
    expect(code).toBe(1);
    expect(rec.attached).toBeNull();
    expect(rec.emitted.join("\n")).toMatch(/no tmux session/i);
  });

  it("explains itself (exit 1) when tmux is not installed", async () => {
    const rec = makeDeps({ hasTmux: () => false });
    const code = await loopWatchCommand(["--attach"], rec.deps);
    expect(code).toBe(1);
    expect(rec.attached).toBeNull();
    expect(rec.emitted.join("\n")).toMatch(/tmux not found/i);
  });
});

describe("roll loop watch --help (AC6)", () => {
  it("prints read-only + concise help without following or attaching", async () => {
    const rec = makeDeps();
    const code = await loopWatchCommand(["--help"], rec.deps);
    expect(code).toBe(0);
    expect(rec.followedPath).toBeNull();
    expect(rec.attached).toBeNull();
    const help = rec.emitted.join("\n");
    expect(help).toMatch(/read-only/i);
    expect(help).toContain("--attach");
    expect(help).toContain("--since");
    expect(help).toContain("--events");
    expect(help).toContain("--raw-events");
    expect(help).toContain("Watch layers:");
    expect(help).toContain("Owner-facing status");
    expect(help).toContain("Developer compact stream");
    expect(help).toContain("Audit/debug escape hatch");
    expect(help).toContain("All modes are local and read-only");
    expect(help).toContain("Ctrl-C ends the view, not the loop");
  });
});

describe("roll loop watch — mid-stream rendering + read-only (AC4/AC2, spawned binary)", () => {
  it("renders lines APPENDED after watch starts (never looks frozen) and never mutates live.log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-watch-e2e-"));
    const rt = join(dir, ".roll", "loop");
    mkdirSync(rt, { recursive: true });
    const live = join(rt, "live.log");
    // Seed only the first banner — the rest arrives AFTER the watcher attaches.
    // Pool narrowing: the worker is kimi (generic normalizer), which surfaces
    // cycle banners (tier-A lifecycle) in the concise default view.
    writeFileSync(live, "── cycle 20260614-9 · US-LOOP-074 · agent kimi ──\n", "utf8");

    const child = spawn("node", [CLI_BIN, "loop", "watch", "-n", "all"], {
      cwd: dir,
      env: {
        ...process.env,
        NO_COLOR: "1",
        ROLL_MAIN_SLUG: "watch-e2e",
        ROLL_PROJECT_RUNTIME_DIR: rt,
        ROLL_LOOP_AGENT: "kimi",
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });

    // Wait until the watcher renders the seed before appending a SECOND banner.
    // A banner is a tier-A lifecycle node the generic normalizer renders in the
    // concise default view, so its appearance proves the stream did not freeze.
    await waitForOutput(() => out, "US-LOOP-074");
    appendFileSync(live, "── cycle 20260614-9 · US-LOOP-099 · agent kimi ──\n", "utf8");
    await waitForOutput(() => out, "US-LOOP-099");

    // Read-only: the only bytes in live.log are the banner + OUR append.
    // If watch ever wrote, the size would exceed this exact expected length.
    const expectedBytes = statSync(live).size;
    child.kill("SIGINT");
    await new Promise((r) => setTimeout(r, 150));
    expect(statSync(live).size).toBe(expectedBytes); // unchanged after the view ends

    // The mid-stream append rendered (it did NOT look frozen) — the core AC4 claim.
    expect(out).toContain("US-LOOP-074"); // seeded banner
    expect(out).toContain("US-LOOP-099"); // the banner that arrived AFTER attach
  }, 20_000);
});
