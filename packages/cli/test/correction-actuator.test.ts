import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCorrectionAction } from "../src/runner/correction-actuator.js";
import type { RollEvent } from "@roll/spec";

function project(): { root: string; events: string; alerts: string; backlog: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-correction-actuator-")));
  const loop = join(root, ".roll", "loop");
  mkdirSync(loop, { recursive: true });
  mkdirSync(join(root, ".roll", "features", "acceptance-evidence", "US-EVID-014"), { recursive: true });
  writeFileSync(join(root, ".roll", "features", "acceptance-evidence", "US-EVID-014", "spec.md"), "# US-EVID-014\n", "utf8");
  const backlog = join(root, ".roll", "backlog.md");
  writeFileSync(
    backlog,
    [
      "# Backlog",
      "",
      "## 🚀 Stories",
      "",
      "| ID | Description | Status |",
      "|----|-------------|--------|",
      "| [US-EVID-014](.roll/features/acceptance-evidence/US-EVID-014/spec.md) | correction story | 🔨 In Progress |",
      "",
      "## 🐛 Bug Fixes",
      "",
      "| ID | Description | Status |",
      "|----|-------------|--------|",
      "",
    ].join("\n"),
    "utf8",
  );
  return { root, events: join(loop, "events.ndjson"), alerts: join(loop, "ALERT-test.md"), backlog };
}

describe("US-EVID-014 correction actuator runner adapter", () => {
  it("conservative default records attribution and ALERT without mutating backlog", () => {
    const p = project();
    const before = readFileSync(p.backlog, "utf8");
    const result = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["no fresh acceptance report for US-EVID-014"],
      nowSec: 100,
    });

    expect(result).toMatchObject({ mode: "conservative", action: "alert_only", plannedAction: "open_fix" });
    expect(readFileSync(p.backlog, "utf8")).toBe(before);
    expect(readFileSync(p.alerts, "utf8")).toContain("correction actuator");
    const events = readFileSync(p.events, "utf8");
    expect(events).toContain('"type":"correction:action"');
    expect(events).toContain('"action":"alert_only"');
    expect(events).toContain('"plannedAction":"open_fix"');
    expect(events).toContain('"failureClass":"card"');
    expect(events).toContain('"rootCauseKey":"card:missing_acceptance"');
  });

  it("US-LOOP-092: auto mode without heterogeneous agree consensus only alerts", () => {
    const p = project();
    writeFileSync(join(p.root, ".roll", "policy.yaml"), "loop_safety:\n  correction_actuator: auto\n");

    const result = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["no fresh acceptance report for US-EVID-014"],
      nowSec: 100,
    });

    expect(result).toMatchObject({ mode: "auto", action: "alert_only", plannedAction: "open_fix", mutation: "alert_only" });
    expect(readFileSync(p.backlog, "utf8")).not.toContain("FIX-001");
    expect(readFileSync(p.alerts, "utf8")).toContain("consensus=denied");
  });

  it("auto mode opens one idempotent manual-merge FIX card with attribution after all review peers agree", () => {
    const p = project();
    writeFileSync(join(p.root, ".roll", "policy.yaml"), "loop_safety:\n  correction_actuator: auto\n");
    writeEvents(p.events, [
      { type: "pair:verdict", cycleId: "cycle-1", peer: "pi", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 90 },
      { type: "pair:verdict", cycleId: "cycle-1", peer: "reasonix", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 91 },
      { type: "pair:verdict", cycleId: "cycle-2", peer: "pi", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 190 },
      { type: "pair:verdict", cycleId: "cycle-2", peer: "reasonix", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 191 },
    ]);

    const first = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["no fresh acceptance report for US-EVID-014"],
      nowSec: 100,
    });
    const second = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-2",
      reasons: ["no fresh acceptance report for US-EVID-014"],
      nowSec: 101,
    });

    expect(first).toMatchObject({ action: "open_fix", fixId: "FIX-001", mutation: "created_fix" });
    expect(second).toMatchObject({ action: "route_adjust", mutation: "alert_only" });
    const backlog = readFileSync(p.backlog, "utf8");
    expect(backlog.match(/FIX-001/g)?.length).toBe(1);
    expect(backlog).toContain("fixes:US-EVID-014");
    expect(backlog).toContain("signal:missing_acceptance_report");
    expect(backlog).toContain("autofix [roll:manual-merge]");
    const spec = join(p.root, ".roll", "features", "acceptance-evidence", "FIX-001", "spec.md");
    expect(existsSync(spec)).toBe(true);
    expect(readFileSync(spec, "utf8")).toContain("Attribution");
    expect(readFileSync(spec, "utf8")).toContain("[roll:manual-merge]");
  });

  it("US-LOOP-092: any review peer disagreement blocks automatic backlog writes", () => {
    const p = project();
    writeFileSync(join(p.root, ".roll", "policy.yaml"), "loop_safety:\n  correction_actuator: auto\n");
    writeEvents(p.events, [
      { type: "pair:verdict", cycleId: "cycle-1", peer: "pi", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 90 },
      { type: "pair:verdict", cycleId: "cycle-1", peer: "reasonix", verdict: "object", findings: 1, cost: 0, stage: "review", ts: 91 },
    ]);

    const result = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["no fresh acceptance report for US-EVID-014"],
      nowSec: 100,
    });

    expect(result).toMatchObject({ action: "alert_only", plannedAction: "open_fix", mutation: "alert_only" });
    expect(readFileSync(p.backlog, "utf8")).not.toContain("FIX-001");
    expect(readFileSync(p.alerts, "utf8")).toContain("consensus=denied");
  });

  it("auto mode returns a regression review-score story to Todo", () => {
    const p = project();
    writeFileSync(join(p.root, ".roll", "policy.yaml"), "loop_safety:\n  correction_actuator: auto\n");
    writeEvents(p.events, [
      { type: "pair:verdict", cycleId: "cycle-1", peer: "pi", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 90 },
      { type: "pair:verdict", cycleId: "cycle-1", peer: "reasonix", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 91 },
    ]);
    const result = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["review-score regression 3/10 blocks Done"],
      nowSec: 100,
    });

    expect(result).toMatchObject({ action: "return_story", mutation: "returned_story" });
    expect(readFileSync(p.backlog, "utf8")).toContain("| 📋 Todo |");
  });

  it("respects a human Hold override instead of requeueing the story", () => {
    const p = project();
    writeFileSync(join(p.root, ".roll", "policy.yaml"), "loop_safety:\n  correction_actuator: auto\n");
    writeEvents(p.events, [
      { type: "pair:verdict", cycleId: "cycle-1", peer: "pi", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 90 },
      { type: "pair:verdict", cycleId: "cycle-1", peer: "reasonix", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 91 },
    ]);
    writeFileSync(
      p.backlog,
      readFileSync(p.backlog, "utf8").replace("🔨 In Progress", "🚫 Hold [human triage]"),
      "utf8",
    );
    const result = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-1",
      reasons: ["review-score regression 3/10 blocks Done"],
      nowSec: 100,
    });

    expect(result).toMatchObject({ action: "return_story", mutation: "human_override" });
    expect(readFileSync(p.backlog, "utf8")).toContain("🚫 Hold [human triage]");
  });

  it("FIX-386: exhausted review-score retry budget marks story Hold", () => {
    const p = project();
    writeFileSync(join(p.root, ".roll", "policy.yaml"), "loop_safety:\n  correction_actuator: auto\n");
    // Simulate two prior correction events so the retry budget is exhausted.
    // Pre-write correction events into the events file.
    const eventsPath = p.events;
    mkdirSync(join(p.root, ".roll", "loop"), { recursive: true });
    writeEvents(eventsPath, [
      { type: "correction:action", storyId: "US-EVID-014", action: "return_story", signal: "review_score_regression", reason: "first low", ts: 10 },
      { type: "correction:action", storyId: "US-EVID-014", action: "return_story", signal: "review_score_regression", reason: "second low", ts: 11 },
      { type: "pair:verdict", cycleId: "cycle-3", peer: "pi", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 90 },
      { type: "pair:verdict", cycleId: "cycle-3", peer: "reasonix", verdict: "agree", findings: 0, cost: 0, stage: "review", ts: 91 },
    ]);
    const result = applyCorrectionAction({
      projectPath: p.root,
      eventsPath: p.events,
      alertsPath: p.alerts,
      storyId: "US-EVID-014",
      cycleId: "cycle-3",
      reasons: ["low review-score ok 3/10 marks partial + Discrepancy"],
      nowSec: 100,
    });

    // FIX-386: when retryBudget is exhausted, route_adjust marks story Hold
    expect(result).toMatchObject({ action: "route_adjust", plannedAction: "route_adjust", retryBudget: 0 });
    expect(result.mutation).toBe("returned_story"); // Hold marker = returned_story mutation
    const backlog = readFileSync(p.backlog, "utf8");
    expect(backlog).toContain("🚫 Hold");
    expect(backlog).toContain("low-review-score");
  });
});

function writeEvents(path: string, events: RollEvent[]): void {
  writeFileSync(path, events.map((ev) => JSON.stringify(ev)).join("\n") + "\n", "utf8");
}
