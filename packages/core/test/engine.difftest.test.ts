/**
 * diff-test: @roll/core reconcile (TTL "进行中" detection) vs the frozen python
 * oracle `lib/loop_unstick.py`.
 *
 * loop_unstick.py is a standalone CLI (read FULLY). Its contract:
 *   - cwd must be a git repo with `.roll/backlog.md`; it derives a project slug
 *     from the git common-dir basename + an md5 (loop_unstick.py:41-56).
 *   - it reads events from `$ROLL_SHARED_ROOT/loop/events-<slug>.ndjson`
 *     (loop_unstick.py:35-39, 58-59).
 *   - `--dry-run` prints `would-revert <id> (cycle ended <outcome> <age:.1f>h ago)`
 *     per qualifying story and writes nothing (loop_unstick.py:154-157); the
 *     default apply prints `reverted <id> ...` and flips the backlog rows.
 *
 * We spawn it in a fresh temp git repo per case, with a sandboxed
 * ROLL_SHARED_ROOT, and value-compare the set of reverted (id, outcome, age-1dp)
 * decisions against the TS `reconcileStuckBacklog`. Timestamps are pinned: the
 * py uses `datetime.now(utc)`, so we make event ts's relative to a base "now"
 * captured in BOTH the python event file (ISO) and the TS call (epoch ms) using
 * the SAME wall clock window — we therefore compare with a 0.1h tolerance to
 * absorb the few-ms spawn skew (py rounds age to 1 decimal anyway).
 *
 * Cases (per the card): stuck-and-stale, stuck-but-fresh, failed-latest-cycle
 * (covered by stale), no-cycle-record.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type UnstickEvent, reconcileStuckBacklog } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const ORACLE = `${REPO}/lib/loop_unstick.py`;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

const HOUR = 3_600_000;

interface EventSpec {
  stage: string;
  detail?: string;
  label?: string;
  outcome?: string;
  /** Hours before "now" the event happened. */
  hoursAgo: number;
}

interface PyRevert {
  id: string;
  outcome: string;
  age: number;
}

/** Run loop_unstick.py --dry-run in a fresh git repo; parse the would-revert lines. */
function pyReverts(backlog: string, events: EventSpec[], ttlHours: number): PyRevert[] {
  const proj = mkdtempSync(join(tmpdir(), "roll-unstick-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(join(proj, ".roll", "backlog.md"), backlog, "utf8");
  execFileSync("git", ["init", "-q"], { cwd: proj });

  const shared = join(proj, "shared");
  mkdirSync(join(shared, "loop"), { recursive: true });

  // Resolve the slug the oracle will compute for this repo.
  const slug = execFileSync(
    "python3",
    [
      "-c",
      [
        "import importlib.util,os",
        "os.chdir(os.environ['PROJ'])",
        "s=importlib.util.spec_from_file_location('u', os.environ['ORACLE'])",
        "m=importlib.util.module_from_spec(s); s.loader.exec_module(m)",
        "print(m._project_slug())",
      ].join("\n"),
    ],
    { cwd: proj, encoding: "utf8", env: { ...process.env, PROJ: proj, ORACLE: ORACLE } },
  ).trim();

  // Write events with ISO timestamps relative to "now" at spawn time.
  const now = Date.now();
  const lines = events.map((e) => {
    const ts = new Date(now - e.hoursAgo * HOUR).toISOString().replace(/\.\d+Z$/, "Z");
    const obj: Record<string, unknown> = { stage: e.stage, ts };
    if (e.detail !== undefined) obj.detail = e.detail;
    if (e.label !== undefined) obj.label = e.label;
    if (e.outcome !== undefined) obj.outcome = e.outcome;
    return JSON.stringify(obj);
  });
  writeFileSync(join(shared, "loop", `events-${slug}.ndjson`), `${lines.join("\n")}\n`, "utf8");

  const out = execFileSync(
    "python3",
    [ORACLE, "--dry-run", "--ttl-hours", String(ttlHours)],
    { cwd: proj, encoding: "utf8", env: { ...process.env, ROLL_SHARED_ROOT: shared } },
  );

  const reverts: PyRevert[] = [];
  for (const line of out.split("\n")) {
    const m = /^would-revert (\S+) \(cycle ended (\S+) ([\d.]+)h ago\)$/.exec(line.trim());
    if (m !== null && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      reverts.push({ id: m[1], outcome: m[2], age: Number(m[3]) });
    }
  }
  return reverts;
}

/** Build the TS event list mirroring the same hoursAgo spec against a fixed now. */
function tsEvents(now: number, events: EventSpec[]): UnstickEvent[] {
  return events.map((e) => ({
    stage: e.stage,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    ...(e.label !== undefined ? { label: e.label } : {}),
    ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
    ts: now - e.hoursAgo * HOUR,
  }));
}

const STALE: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 6.01 },
  { stage: "cycle_end", label: "c", outcome: "failed", hoursAgo: 6 },
];
const FRESH: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 2.01 },
  { stage: "cycle_end", label: "c", outcome: "failed", hoursAgo: 2 },
];
const ABORTED_STALE: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 5.01 },
  { stage: "cycle_end", label: "c", outcome: "aborted", hoursAgo: 5 },
];
const NO_CYCLE: EventSpec[] = [{ stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 6 }];
const DELIVERED_STALE: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 6.01 },
  { stage: "cycle_end", label: "c", outcome: "delivered", hoursAgo: 6 },
];

const BACKLOG = "| US-1 | foo bar | 🔨 In Progress |\n";

describe("diff-test: reconcileStuckBacklog == loop_unstick.py TTL gate", () => {
  const cases: { name: string; events: EventSpec[]; ttl: number; expectRevert: boolean }[] = [
    { name: "stuck-and-stale (failed 6h > 4h TTL)", events: STALE, ttl: 4, expectRevert: true },
    { name: "stuck-but-fresh (failed 2h < 4h TTL)", events: FRESH, ttl: 4, expectRevert: false },
    { name: "failed-latest-cycle aborted, stale", events: ABORTED_STALE, ttl: 4, expectRevert: true },
    { name: "no-cycle-record (still running)", events: NO_CYCLE, ttl: 4, expectRevert: false },
    { name: "delivered latest cycle is never reverted", events: DELIVERED_STALE, ttl: 4, expectRevert: false },
  ];

  for (const { name, events, ttl, expectRevert } of cases) {
    it(name, () => {
      const py = pyReverts(BACKLOG, events, ttl);
      const now = Date.now();
      const ts = reconcileStuckBacklog(BACKLOG, tsEvents(now, events), now, ttl);

      expect(py.length === 1).toBe(expectRevert);
      expect(ts.length === 1).toBe(expectRevert);
      // Same set of reverted ids + outcomes.
      expect(ts.map((r) => r.storyId).sort()).toEqual(py.map((r) => r.id).sort());
      if (expectRevert) {
        expect(ts[0]?.outcome).toBe(py[0]?.outcome);
        // Age agrees to within the spawn-time skew (py rounds to 1dp).
        expect(ts[0]?.ageHours ?? 0).toBeCloseTo(py[0]?.age ?? 0, 1);
      }
    });
  }
});
