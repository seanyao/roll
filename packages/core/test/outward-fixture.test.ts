/**
 * US-ATTEST-017 — AC4: a complete rendered report fixture that shows all three
 * outward states side by side — a simulation pass, an external UNVERIFIED state,
 * and a real external-smoke pass — plus one owner-attested AC. The rendered HTML
 * is committed as a golden fixture a human can open; this test regenerates it
 * (UPDATE_FIXTURES=1) and otherwise asserts the committed bytes have not drifted
 * and that the non-green states never read as green acceptance.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderReport, type ReportInput } from "../src/attest/report.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "outward-verification", "report.html");

const FIXTURE_INPUT: ReportInput = {
  storyId: "US-DEMO-042",
  title: "US-DEMO-042 — Global git install channel",
  generatedAt: "2026-07-15T00:00:00Z",
  items: [
    {
      id: "US-DEMO-042:AC1",
      text: "The command parser accepts the new --channel flag.",
      status: "pass",
      evidence: [{ kind: "test-pass", label: "cli parser suite green" }],
    },
    {
      id: "US-DEMO-042:AC3",
      text: "npm pack produces a tarball with the documented bin entry.",
      status: "claimed",
      evidence: [{ kind: "test-pass", label: "npm pack simulation" }],
      note: "verified-in-simulation only — npm pack passed, but no external install smoke ran.",
    },
    {
      id: "US-DEMO-042:AC4",
      text: "npm i -g github:owner/repo#<commit> installs and starts in a clean directory.",
      status: "claimed",
      evidence: [],
      note: "external release smoke has not run in this environment.",
    },
    {
      id: "US-DEMO-042:AC5",
      text: "The published CLI prints its version on first run.",
      status: "pass",
      evidence: [{ kind: "test-pass", label: "release smoke: r --version → 3.715.0" }],
    },
  ],
  outwardVerification: [
    {
      ac: "US-DEMO-042:AC3",
      mode: "external-smoke",
      status: "verified-in-simulation",
      environment: "release",
      command: "npm pack && tar tf *.tgz",
      detail: "local simulation passed but no external smoke results exist — this is not a positive verification",
    },
    {
      ac: "US-DEMO-042:AC4",
      mode: "external-smoke",
      status: "unverified-external",
      environment: "release",
      command: "npm i -g github:owner/repo#<commit> && repo --version",
      detail: 'no smoke results available for environment "release" and no local simulation evidence',
    },
    {
      ac: "US-DEMO-042:AC5",
      mode: "external-smoke",
      status: "verified",
      environment: "release",
      command: "repo --version",
      detail: "smoke passed",
    },
    {
      ac: "US-DEMO-042:AC6",
      mode: "owner-attested",
      status: "unverified-external",
      approvalRef: "https://github.com/owner/repo/issues/1343",
      detail: "manual OAuth callback verification at issue #1343 is pending",
    },
  ],
  facts: { tcrCount: 4, ciConclusion: "success", testPassAge: "12s ago" },
};

describe("US-ATTEST-017 — rendered outward-verification fixture (AC4)", () => {
  const html = renderReport(FIXTURE_INPUT);

  it("regenerates and matches the committed golden fixture", () => {
    if (process.env.UPDATE_FIXTURES === "1" || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, html);
    }
    expect(html).toBe(readFileSync(FIXTURE, "utf8"));
  });

  it("shows the simulation pass, the external unverified, and the real smoke pass together", () => {
    // simulation pass — present but NOT green
    expect(html).toContain("verified-in-simulation");
    expect(html).toContain("simulation only, NOT accepted");
    // external unverified — the red line string
    expect(html).toContain("UNVERIFIED — external smoke not run");
    // real external smoke pass — the one green outward result
    expect(html).toContain("VERIFIED (external smoke)");
    // owner-attested pending
    expect(html).toContain("UNVERIFIED — owner attestation pending");
    // one non-green AC forces the banner into its warning state
    expect(html).toContain('class="ov-banner ov-banner-warn"');
    expect(html).not.toContain('class="ov-banner ov-banner-ok"');
  });
});
