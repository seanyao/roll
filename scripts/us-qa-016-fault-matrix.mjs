#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const matrix = [
  {
    id: "FI-01",
    title: "shared checkout pollution",
    summary: "builder leakage is quarantined, main is restored, and a fresh cycle can continue",
  },
  {
    id: "FI-02",
    title: "attest render failure",
    summary: "attest render failure hard-blocks the gate so publish cannot mark Done",
  },
  {
    id: "FI-03",
    title: "dangling ac-map path",
    summary: "unresolved ac-map evidence is rejected by the merge evidence gate",
  },
  {
    id: "FI-04",
    title: "provider/auth probe and CI unavailable",
    summary: "external root causes pause by root-cause key with diagnostic snapshots and no card blame",
  },
  {
    id: "FI-05",
    title: "dirty .roll meta",
    summary: "dirty roll-meta/runtime files are ignored by product checkout dirt checks",
  },
  {
    id: "FI-06",
    title: "concurrent loop contention",
    summary: "single-flight locking and scheduler ownership prevent duplicate delivery",
  },
  {
    id: "FI-07",
    title: "pardoned card reschedule",
    summary: "clearing a false skip re-arms the card and allows a normal delivery cycle",
  },
  {
    id: "FI-08",
    title: "hung builder timeout",
    summary: "a no-progress hung builder is killed, blocks terminal, releases the lock, and preserves the branch",
  },
];

const EXPECTED_FI_IDS = matrix.map((row) => row.id);

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

const outPath = argValue("--output");
const tmp = mkdtempSync(join(tmpdir(), "roll-qa016-matrix-"));
const reportPath = join(tmp, "vitest.json");
const command = [
  "pnpm",
  "--filter",
  "@roll/cli",
  "exec",
  "vitest",
  "run",
  "test/us-qa-016-fault-matrix.test.ts",
  "--reporter=json",
  `--outputFile=${reportPath}`,
];

const run = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
let vitest = {};
let parseError = null;
try {
  vitest = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (e) {
  vitest = {};
  parseError = e instanceof Error ? e.message : String(e);
}

const assertions = [];
for (const suite of Array.isArray(vitest.testResults) ? vitest.testResults : []) {
  for (const assertion of Array.isArray(suite.assertionResults) ? suite.assertionResults : []) {
    assertions.push(assertion);
  }
}

const titleIds = [];
const unparsedTitles = [];
for (const assertion of assertions) {
  const title = typeof assertion.title === "string"
    ? assertion.title
    : typeof assertion.fullName === "string"
      ? assertion.fullName
      : "";
  if (title === "") {
    unparsedTitles.push("<missing title>");
    continue;
  }
  const matches = [...title.matchAll(/\[(FI-\d{2})\]/g)].map((m) => m[1]);
  if (matches.length !== 1) {
    unparsedTitles.push(title);
    continue;
  }
  titleIds.push(matches[0]);
}

const actualIds = [...new Set(titleIds)].sort();
const duplicateIds = [...new Set(titleIds.filter((id, idx) => titleIds.indexOf(id) !== idx))].sort();
const missingIds = EXPECTED_FI_IDS.filter((id) => !actualIds.includes(id));
const extraIds = actualIds.filter((id) => !EXPECTED_FI_IDS.includes(id));
const reconciliationErrors = [
  ...(parseError !== null ? [`vitest json parse failed: ${parseError}`] : []),
  ...(missingIds.length > 0 ? [`missing FI test titles: ${missingIds.join(", ")}`] : []),
  ...(extraIds.length > 0 ? [`unexpected FI test titles: ${extraIds.join(", ")}`] : []),
  ...(duplicateIds.length > 0 ? [`duplicate FI test titles: ${duplicateIds.join(", ")}`] : []),
  ...(unparsedTitles.length > 0 ? [`unparseable test titles: ${unparsedTitles.join(" | ")}`] : []),
];

const results = matrix.map((row) => {
  const assertion = assertions.find((a) => typeof a.title === "string" && a.title.includes(`[${row.id}]`));
  const passed = assertion?.status === "passed";
  return {
    id: row.id,
    title: row.title,
    status: passed ? "pass" : "fail",
    summary: row.summary,
    testName: assertion?.fullName ?? null,
    durationMs: typeof assertion?.duration === "number" ? Math.round(assertion.duration) : null,
    failure: passed ? null : (assertion?.failureMessages ?? ["test result missing"]).join("\n"),
  };
});

const payload = {
  storyId: "US-QA-016",
  scope: "fault-injection-matrix",
  generatedAt: new Date().toISOString(),
  command: command.join(" "),
  vitest: {
    exitCode: run.status ?? 1,
    success: vitest.success === true,
    passed: vitest.numPassedTests ?? results.filter((r) => r.status === "pass").length,
    total: vitest.numTotalTests ?? results.length,
  },
  reconciliation: {
    expectedFiIds: EXPECTED_FI_IDS,
    actualFiIds: actualIds,
    errors: reconciliationErrors,
  },
  results,
};

const body = `${JSON.stringify(payload, null, 2)}\n`;
if (outPath !== undefined && outPath.trim() !== "") writeFileSync(outPath, body, "utf8");
process.stdout.write(body);
rmSync(tmp, { recursive: true, force: true });
process.exit(reconciliationErrors.length > 0 ? 1 : (run.status ?? 1));
