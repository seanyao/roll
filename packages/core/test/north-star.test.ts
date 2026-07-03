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

function run(id: string, ts: string, status = "failed", extra: Partial<NorthStarRun> = {}): NorthStarRun {
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
    expect(report.metrics.deliveryRate.target).toMatchObject({ op: ">=", value: 0.6 });
    expect(report).toMatchSnapshot();
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
  const interruptionTypes: NorthStarEvent["type"][] = [
    "policy:safety_pause",
    "correction:circuit_breaker",
    "loop:resumed",
    "cycle:rescue",
    "goal:recovery",
    "sandbox:quarantined",
  ];

  for (const type of interruptionTypes) {
    it(`resets current autonomy on ${type}`, () => {
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
      expect(report.metrics.autonomy.context.interruptions).toBe(1);
    });
  }

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
});

describe("M2/M3/M4 anti-gaming contexts", () => {
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

describe("real-history replay shape for 2026-06-20..2026-07-03", () => {
  it("matches a manually audited slice for M1 and M2", () => {
    const days = shDays("2026-07-03");
    const runs: NorthStarRun[] = [];
    for (let d = 0; d < 14; d++) {
      const dayStart = days[d]?.startMs ?? 0;
      for (let i = 0; i < 6; i++) {
        runs.push(run(`real-${d}-${i}`, new Date(dayStart + i * hour).toISOString(), i < 3 ? "merged" : "failed", {
          storyId: i < 3 ? `US-REAL-${d}-${i}` : `FIX-REAL-${d}-${i}`,
        }));
      }
    }
    // Manual audit for this fixture:
    // - Each of 14 Shanghai days has exactly 6 non-idle attempts, so every day
    //   is effective for M1.
    // - A safety pause at 2026-07-01 00:00Z resets autonomy; from then to
    //   2026-07-03 16:00Z is exactly 64 hours.
    // - M2 has 42 delivered rows / 84 non-idle rows = 0.5.
    const report = buildNorthStarReport({
      nowMs: ms("2026-07-03T16:00:00Z"),
      days,
      runs,
      events: [interruption("policy:safety_pause", "2026-07-01T00:00:00Z")],
      cards: [],
      backlog: [],
      deliveries: [],
    });

    expect(report.metrics.autonomy.current).toBe(64);
    expect(report.metrics.deliveryRate.current).toBe(0.5);
  });
});
