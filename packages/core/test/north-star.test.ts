import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildNorthStarReport,
  isNorthStarReport,
  normalizeEventTimestampMs,
  type NorthStarDay,
  type NorthStarEvent,
  type NorthStarRun,
} from "../src/index.js";

const hour = 3600 * 1000;
const day = 24 * hour;

function ms(iso: string): number {
  return Date.parse(iso);
}

function shDays(endDay: string, count = 14): NorthStarDay[] {
  const [year, month, date] = endDay.split("-").map(Number);
  const endStart = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1) - 8 * hour;
  return Array.from({ length: count }, (_, i) => {
    const startMs = endStart - (count - 1 - i) * day;
    const d = new Date(startMs + 8 * hour);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    return { key, startMs, endMs: startMs + day };
  });
}

function run(id: string, ts: string | number, status = "failed", extra: Partial<NorthStarRun> = {}): NorthStarRun {
  return {
    cycleId: id,
    runId: id,
    status,
    outcome: status,
    ts,
    storyId: extra.storyId ?? `US-${id}`,
    built: extra.built ?? [],
    failureClass: extra.failureClass,
    rootCauseKey: extra.rootCauseKey,
  };
}

function readJsonlFixture(file: string): Record<string, unknown>[] {
  return readFileSync(join(__dirname, "fixtures", "north-star", file), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown)
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row));
}

function str(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function num(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

function interruption(type: NorthStarEvent["type"], ts: string, extra: Partial<NorthStarEvent> = {}): NorthStarEvent {
  return { type, ts: ms(ts), ...extra };
}

describe("north-star timestamp normalization", () => {
  it("normalizes mixed seconds and milliseconds event timestamps", () => {
    expect(normalizeEventTimestampMs(1783041451)).toBe(1783041451000);
    expect(normalizeEventTimestampMs(1783041451601)).toBe(1783041451601);
    expect(normalizeEventTimestampMs("2026-07-03T01:17:31Z")).toBe(ms("2026-07-03T01:17:31Z"));
  });
});

describe("north-star report schema", () => {
  it("emits the fixed four-metric schema and passes the type guard", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [
        run("1", "2026-07-03T01:00:00Z", "merged", { storyId: "US-A", built: ["US-A"] }),
        run("2", "2026-07-03T02:00:00Z", "failed", { storyId: "FIX-A", failureClass: "unknown" }),
      ],
      events: [],
      cards: [{ id: "US-A", type: "us", epic: "product", created: "2026-07-01" }],
      backlog: [{ id: "US-A", status: "Done" }],
      deliveries: [],
    });

    expect(isNorthStarReport(report)).toBe(true);
    expect(Object.keys(report.metrics)).toEqual(["autonomy", "deliveryRate", "fixTax", "attributionErrors"]);
    expect(report.metrics.autonomy.daily).toHaveLength(14);
    expect(report.metrics.autonomy.context).toHaveProperty("disruptions");
    expect(report.metrics.autonomy.context).toHaveProperty("segmentBoundaries");
    expect(report.metrics.autonomy.context).not.toHaveProperty("interruptions");
    expect(report.metrics.deliveryRate.target).toMatchObject({ op: ">=", value: 0.6 });
    expect(report).toMatchSnapshot();
  });

  it("accepts compatible roll.north schema extensions without pinning windowDays", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [run("1", "2026-07-03T01:00:00Z", "merged", { storyId: "US-A" })],
      events: [],
      cards: [],
      backlog: [{ id: "US-A", status: "Done" }],
      deliveries: [],
    });

    const extended = {
      ...report,
      schema: "roll.north.v2",
      windowDays: 30,
      extra: { tolerated: true },
      metrics: {
        ...report.metrics,
        autonomy: {
          ...report.metrics.autonomy,
          daily: report.metrics.autonomy.daily.slice(0, 2),
          extraMetricField: true,
        },
      },
    };

    expect(isNorthStarReport(extended)).toBe(true);
  });

  it("returns null plus reasons for a new project with no history", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [],
      events: [],
      cards: [],
      backlog: [],
      deliveries: [],
    });

    for (const metric of Object.values(report.metrics)) {
      expect(metric.current).toBeNull();
      expect(metric.reason).toBe("no_history");
      expect(metric.met).toBe(false);
      expect(metric.daily.every((d) => d.value === null && d.reason === "no_history")).toBe(true);
    }
  });
});

describe("M1 autonomy", () => {
  const disruptionTypes: NorthStarEvent["type"][] = [
    "policy:safety_pause",
    "correction:circuit_breaker",
    "cycle:rescue",
    "goal:recovery",
    "sandbox:quarantined",
  ];

  for (const type of disruptionTypes) {
    it(`counts and segments autonomy on ${type}`, () => {
      const report = buildNorthStarReport({
        nowMs: ms("2026-07-03T12:00:00Z"),
        days: shDays("2026-07-03"),
        runs: Array.from({ length: 6 }, (_, i) => run(`A${i}`, `2026-07-03T0${i}:00:00Z`)),
        events: [interruption(type, "2026-07-03T10:00:00Z", { actor: type === "goal:recovery" ? "owner" : undefined })],
        cards: [],
        backlog: [{ id: "US-A", status: "Todo" }],
        deliveries: [],
      });

      expect(report.metrics.autonomy.current).toBe(2);
      expect(report.metrics.autonomy.context.disruptions).toBe(1);
      expect(report.metrics.autonomy.context.segmentBoundaries).toBe(1);
    });
  }

  it("keeps denied owner goal recovery in disruptions because the owner intervened", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T12:00:00Z"),
      days: shDays("2026-07-03"),
      runs: Array.from({ length: 6 }, (_, i) => run(`D${i}`, `2026-07-03T0${i}:00:00Z`)),
      events: [interruption("goal:recovery", "2026-07-03T10:00:00Z", { actor: "owner" })],
      cards: [],
      backlog: [{ id: "US-A", status: "Todo" }],
      deliveries: [],
    });

    expect(report.metrics.autonomy.current).toBe(2);
    expect(report.metrics.autonomy.context.disruptions).toBe(1);
  });

  it("uses loop:resumed only as a deduplicated segment boundary", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T12:00:00Z"),
      days: shDays("2026-07-03"),
      runs: Array.from({ length: 6 }, (_, i) => run(`R${i}`, `2026-07-03T0${i}:00:00Z`)),
      events: [
        interruption("loop:resumed", "2026-07-03T08:00:00Z"),
        interruption("loop:resumed", "2026-07-03T09:00:00Z"),
        interruption("loop:resumed", "2026-07-03T10:00:00Z"),
      ],
      cards: [],
      backlog: [{ id: "US-A", status: "Todo" }],
      deliveries: [],
    });

    expect(report.metrics.autonomy.current).toBe(4);
    expect(report.metrics.autonomy.context.disruptions).toBe(0);
    expect(report.metrics.autonomy.context.segmentBoundaries).toBe(1);
  });

  it("does not grow through two stopped days with fewer than six non-idle attempts", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [
        run("only-1", "2026-07-01T01:00:00Z"),
        run("only-2", "2026-07-02T01:00:00Z"),
        run("only-3", "2026-07-03T01:00:00Z"),
      ],
      events: [interruption("policy:safety_pause", "2026-07-01T00:00:00Z")],
      cards: [],
      backlog: [{ id: "US-A", status: "Todo" }],
      deliveries: [],
    });

    expect(report.metrics.autonomy.current).toBe(0);
    expect(report.metrics.autonomy.context.ineffectiveDays).toContain("2026-07-02");
  });

  it("assigns an effective cycle crossing +8 midnight to both Shanghai days", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T18:00:00Z"),
      days: shDays("2026-07-04"),
      runs: [
        ...[
          "2026-07-03T10:00:00Z",
          "2026-07-03T11:00:00Z",
          "2026-07-03T12:00:00Z",
          "2026-07-03T13:00:00Z",
          "2026-07-03T14:00:00Z",
          "2026-07-03T15:00:00Z",
        ].map((ts, i) => run(`pre-${i}`, ts)),
        ...[
          "2026-07-03T16:00:00Z",
          "2026-07-03T17:00:00Z",
          "2026-07-03T18:00:00Z",
          "2026-07-03T19:00:00Z",
          "2026-07-03T20:00:00Z",
          "2026-07-03T21:00:00Z",
        ].map((ts, i) => run(`post-${i}`, ts)),
      ],
      events: [interruption("policy:safety_pause", "2026-07-03T14:00:00Z")],
      cards: [],
      backlog: [{ id: "US-A", status: "Todo" }],
      deliveries: [],
    });

    expect(report.metrics.autonomy.context.ineffectiveDays).not.toContain("2026-07-03");
    expect(report.metrics.autonomy.context.ineffectiveDays).not.toContain("2026-07-04");
    expect(report.metrics.autonomy.current).toBe(4);
  });

  it("pauses the autonomy clock on backlog-empty exempt days without accruing hours", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [run("done", "2026-07-03T01:00:00Z", "merged", { storyId: "US-DONE" })],
      events: [],
      cards: [],
      backlog: [],
      deliveries: [],
    });

    expect(report.metrics.autonomy.current).toBe(0);
    expect(report.metrics.autonomy.context.bestHours).toBe(0);
    expect(report.metrics.autonomy.context.backlogEmptyExemptDays).toContain("2026-07-03");
    expect(report.metrics.autonomy.daily.find((d) => d.day === "2026-07-03")).toMatchObject({ exempt: true, value: 0 });
  });

  it("aggregates autonomy current as the 14-day window sum of per-day eligible hours", () => {
    const days = shDays("2026-07-03");
    const runs: NorthStarRun[] = [];
    // Shanghai day 2026-06-20: UTC 2026-06-19T16:00Z..2026-06-20T16:00Z
    for (let i = 0; i < 6; i++) runs.push(run(`d20-${i}`, `2026-06-19T${String(17 + i).padStart(2, "0")}:00:00Z`));
    // Shanghai day 2026-06-21: UTC 2026-06-20T16:00Z..2026-06-21T16:00Z
    for (let i = 0; i < 6; i++) runs.push(run(`d21-${i}`, `2026-06-20T${String(17 + i).padStart(2, "0")}:00:00Z`));
    // Shanghai day 2026-06-22: UTC 2026-06-21T16:00Z..2026-06-22T16:00Z
    for (let i = 0; i < 6; i++) runs.push(run(`d22-${i}`, `2026-06-21T${String(17 + i).padStart(2, "0")}:00:00Z`));
    // Shanghai day 2026-06-23: UTC 2026-06-22T16:00Z..2026-06-23T16:00Z; stop 1.41h into it
    for (let i = 0; i < 6; i++) runs.push(run(`d23-${i}`, `2026-06-22T${String(17 + i).padStart(2, "0")}:00:00Z`));

    const nowMs = ms("2026-06-22T17:24:36Z"); // 1.41h after 2026-06-22T16:00Z
    const report = buildNorthStarReport({
      nowMs,
      days,
      runs,
      events: [],
      cards: [],
      backlog: [{ id: "US-A", status: "Todo" }],
      deliveries: [],
    });

    expect(report.metrics.autonomy.current).toBe(73.41);
    expect(report.metrics.autonomy.met).toBe(true);
    expect(report.metrics.autonomy.daily.reduce((sum, d) => sum + d.value, 0)).toBeCloseTo(73.41, 2);
    expect(report.metrics.autonomy.context.segmentHours).toBe(73.41);
    expect(report.metrics.autonomy.context.bestHours).toBe(73.41);
    // Invariants from the evaluation contract.
    expect(report.metrics.autonomy.current).toBeLessThanOrEqual(24 * report.windowDays);
    const reordered = buildNorthStarReport({
      nowMs,
      days,
      runs: [...runs].sort(() => 0.5 - Math.random()),
      events: [],
      cards: [],
      backlog: [{ id: "US-A", status: "Todo" }],
      deliveries: [],
    });
    expect(reordered.metrics.autonomy.current).toBe(report.metrics.autonomy.current);
  });
});

describe("M2/M3/M4 anti-gaming contexts", () => {
  it("counts numeric run timestamps across M2, M3, and M4", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [
        run("numeric-delivered", Math.floor(ms("2026-07-03T01:00:00Z") / 1000), "merged", { storyId: "US-NUMERIC" }),
        run("numeric-failed", ms("2026-07-03T02:00:00Z"), "failed", { storyId: "US-FAILED" }),
      ],
      events: [{ type: "goal:card_skipped", ts: ms("2026-07-03T03:00:00Z"), storyId: "US-FAILED", failureClass: "env" }],
      cards: [{ id: "FIX-NUMERIC", type: "fix", epic: "loop-harness", created: "2026-07-03" }],
      backlog: [{ id: "US-A", status: "Todo" }],
      deliveries: [],
    });

    expect(report.metrics.deliveryRate.context.nonIdleCycles).toBe(2);
    expect(report.metrics.deliveryRate.current).toBe(0.5);
    expect(report.metrics.fixTax.current).toBe(1);
    expect(report.metrics.attributionErrors.context.failedCycles).toBe(1);
  });

  it("exposes abnormal skip rate and card type mix when easy cards are selected", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [
        run("d1", "2026-07-03T01:00:00Z", "merged", { storyId: "FIX-EASY", built: ["FIX-EASY"] }),
        run("d2", "2026-07-03T02:00:00Z", "merged", { storyId: "FIX-EASY2", built: ["FIX-EASY2"] }),
        run("b1", "2026-07-03T03:00:00Z", "blocked", { storyId: "US-HARD" }),
      ],
      events: [
        { type: "goal:card_skipped", ts: ms("2026-07-03T04:00:00Z"), storyId: "US-HARD" },
        { type: "goal:card_skipped", ts: ms("2026-07-03T05:00:00Z"), storyId: "US-HARD2" },
      ],
      cards: [],
      backlog: [],
      deliveries: [],
    });

    expect(report.metrics.deliveryRate.current).toBeCloseTo(2 / 3);
    expect(report.metrics.deliveryRate.context.skipRate).toBeCloseTo(2 / 3);
    expect(report.metrics.deliveryRate.context.blockedRate).toBeCloseTo(1 / 3);
    expect(report.metrics.deliveryRate.context.cardTypes).toMatchObject({ fix: 2, us: 1 });
  });

  it("counts same-root FIX repeats without penalizing honest card creation invisibly", () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      run(`fix-${i}`, "2026-07-03T01:00:00Z", "failed", {
        storyId: `FIX-${i}`,
        rootCauseKey: "same-root",
      }),
    );
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [run("us", "2026-07-03T00:00:00Z", "merged", { storyId: "US-DONE" }), ...runs],
      events: [],
      cards: [
        ...runs.map((r) => ({ id: r.storyId ?? "", type: "fix" as const, epic: "loop-harness", created: "2026-07-03" })),
        { id: "US-DONE", type: "us", epic: "product", created: "2026-07-01" },
      ],
      backlog: [],
      deliveries: [],
    });

    expect(report.metrics.fixTax.current).toBe(5);
    expect(report.metrics.fixTax.context.duplicateRootCauseCount).toBe(5);
    expect(report.metrics.fixTax.context.byClass.harness).toBe(5);
  });

  it("uses only US deliveries as the fix-tax denominator and exposes REFACTOR deliveries as context", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [
        run("us", "2026-07-03T00:00:00Z", "merged", { storyId: "US-DONE" }),
        run("refactor", "2026-07-03T01:00:00Z", "merged", { storyId: "REFACTOR-DONE" }),
      ],
      events: [],
      cards: [
        { id: "FIX-1", type: "fix", epic: "loop-harness", created: "2026-07-03" },
        { id: "US-DONE", type: "us", epic: "product", created: "2026-07-01" },
        { id: "REFACTOR-DONE", type: "refactor", epic: "product", created: "2026-07-01" },
      ],
      backlog: [],
      deliveries: [],
    });

    expect(report.metrics.fixTax.current).toBe(1);
    expect(report.metrics.fixTax.context.productDeliveries).toBe(1);
    expect(report.metrics.fixTax.context.refactorDeliveries).toBe(1);
  });

  it("counts missing failure_class as unknown and env/harness skips as attribution errors", () => {
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days: shDays("2026-07-03"),
      runs: [
        run("unknown", "2026-07-03T01:00:00Z", "failed", { storyId: "US-U" }),
        run("env", "2026-07-03T02:00:00Z", "failed", { storyId: "US-E", failureClass: "env" }),
      ],
      events: [{ type: "goal:card_skipped", ts: ms("2026-07-03T03:00:00Z"), storyId: "US-E", failureClass: "env" }],
      cards: [],
      backlog: [],
      deliveries: [],
    });

    expect(report.metrics.attributionErrors.current).toBe(1);
    expect(report.metrics.attributionErrors.context.unknownFailureClass).toBe(1);
  });
});

describe("real-history replay for 2026-06-20..2026-07-03", () => {
  it("matches the audited real-data slice for M1 and M2", () => {
    const days = shDays("2026-07-03");
    const runs = readJsonlFixture("runs.jsonl").map((row): NorthStarRun => ({
      runId: str(row, "run_id"),
      cycleId: str(row, "cycle_id"),
      status: str(row, "status"),
      outcome: str(row, "outcome"),
      ts: str(row, "ts") ?? num(row, "ts"),
      storyId: str(row, "story_id"),
      failureClass: str(row, "failure_class"),
      rootCauseKey: str(row, "root_cause_key"),
    }));
    const events = readJsonlFixture("events.ndjson").map((row): NorthStarEvent => ({
      type: str(row, "type"),
      ts: str(row, "ts") ?? num(row, "ts"),
      storyId: str(row, "storyId") ?? str(row, "story_id"),
      actor: str(row, "actor"),
      failureClass: str(row, "failure_class") ?? str(row, "failureClass"),
    }));
    const deliveries = readJsonlFixture("deliveries.jsonl").map((row) => ({
      storyId: str(row, "storyId") ?? "",
      lifecycleState: str(row, "lifecycleState"),
      recordedAt: num(row, "recordedAt"),
    }));
    // Manual audit notes for the committed fixture:
    // - Window: Shanghai days 2026-06-20..2026-07-03, fixed at
    //   2026-07-03T15:59:59Z (23:59:59 UTC+8).
    // - M1: 71 true disruption events and 108 deduplicated segment boundaries.
    //   loop:resumed starts a new segment but is not itself a disruption.
    //   The longest valid segment is 26.29h. The 14-day window aggregate of
    //   eligible per-day autonomy hours is 85.61h (FIX-1265: current is the
    //   window sum, not the trailing segment).
    // - M2: 304 non-idle runs and 113 delivered/merged/done/published runs,
    //   so delivery rate = 113 / 304 = 0.3717105263157895.
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T15:59:59Z"),
      days,
      runs,
      events,
      cards: [],
      backlog: [{ id: "US-ACTIVE", status: "Todo" }],
      deliveries,
    });

    expect(report.metrics.autonomy.current).toBe(85.61);
    expect(report.metrics.autonomy.context.bestHours).toBe(26.29);
    expect(report.metrics.autonomy.context.disruptions).toBe(71);
    expect(report.metrics.autonomy.context.segmentBoundaries).toBe(108);
    expect(report.metrics.deliveryRate.current).toBe(113 / 304);
    expect(report.metrics.deliveryRate.context.nonIdleCycles).toBe(304);
    expect(report.metrics.deliveryRate.context.deliveredCycles).toBe(113);
  });

  it("computes current-scale event volumes under the performance budget", () => {
    const days = shDays("2026-07-03");
    const baseEvents = readJsonlFixture("events.ndjson").map((row): NorthStarEvent => ({
      type: str(row, "type"),
      ts: str(row, "ts") ?? num(row, "ts"),
      storyId: str(row, "storyId") ?? str(row, "story_id"),
      actor: str(row, "actor"),
      failureClass: str(row, "failure_class") ?? str(row, "failureClass"),
    }));
    const events = Array.from({ length: 13_018 }, (_, index) => baseEvents[index % baseEvents.length] ?? { type: "noop", ts: ms("2026-07-03T00:00:00Z") });
    const start = performance.now();
    buildNorthStarReport({
      nowMs: ms("2026-07-03T15:59:59Z"),
      days,
      runs: [run("p1", "2026-07-03T01:00:00Z", "merged", { storyId: "US-PERF" })],
      events,
      cards: [],
      backlog: [{ id: "US-ACTIVE", status: "Todo" }],
      deliveries: [],
    });
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(5000);
  });
});
