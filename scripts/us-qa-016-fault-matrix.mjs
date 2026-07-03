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
];

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
try {
  vitest = JSON.parse(readFileSync(reportPath, "utf8"));
} catch {
  vitest = {};
}

const assertions = [];
for (const suite of Array.isArray(vitest.testResults) ? vitest.testResults : []) {
  for (const assertion of Array.isArray(suite.assertionResults) ? suite.assertionResults : []) {
    assertions.push(assertion);
  }
}

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
  results,
};

const body = `${JSON.stringify(payload, null, 2)}\n`;
if (outPath !== undefined && outPath.trim() !== "") writeFileSync(outPath, body, "utf8");
process.stdout.write(body);
rmSync(tmp, { recursive: true, force: true });
process.exit(run.status ?? 1);
