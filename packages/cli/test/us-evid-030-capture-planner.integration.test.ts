/**
 * US-EVID-030 (AC6 + scorer_focus) — end-to-end capture-planner fixture.
 *
 * Proves the planner ACTUALLY DISPATCHES both eligible lanes for ONE declared
 * surface, writes REAL PNGs (not placeholder paths), and attaches BOTH a
 * physical AND a rendered receipt to the SAME CaptureSet, then folds both into
 * the run evidence manifest and the report — crossing every package boundary:
 *   spec (validate) → core (CapturePlanner) → infra (real store + manifest)
 *   → core (report attachment).
 *
 * There is no live Capture.app or real browser here (external cards
 * US-CAPTURE-017/018); the lane executors are injected fakes that write real
 * captured artifacts, exactly as this card's `screenshot_exempt` reason allows.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureIntentV2, CaptureReceiptV2 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V2, isAcceptedCaptureReceiptV2 } from "@roll/spec";
import {
  CapturePlanner,
  captureReceiptEvidenceRef,
  renderReport,
  type CaptureLanePort,
  type DeclaredSurface,
} from "@roll/core";
import {
  RollCaptureReceiptStore,
  captureReceiptFact,
  collectEvidence,
  writeEvidenceJson,
  type CaptureReceiptFact,
  type EvidenceManifest,
} from "@roll/infra";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SURFACE = "http://localhost:3000/team";
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A fake lane executor that writes a REAL PNG to the harness-derived out path. */
function fakeLane(source: CaptureLanePort["source"], seed: number): CaptureLanePort {
  return {
    source,
    async run(intent: CaptureIntentV2): Promise<CaptureReceiptV2> {
      const bytes = Buffer.from([...PNG_HEADER, seed, seed + 1, seed + 2, seed + 3]);
      writeFileSync(intent.out, bytes);
      const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const captureClass = source === "roll-capture-window" ? "physical" : "rendered";
      return {
        protocol: ROLL_CAPTURE_PROTOCOL_V2,
        requestId: intent.requestId,
        storyId: intent.storyId,
        runId: intent.runId,
        surfaceId: intent.surface.id,
        source,
        captureClass,
        state: "taken",
        screenshotPath: intent.out,
        sha256,
        ...(captureClass === "rendered" ? { finalUrl: intent.surface.id } : {}),
        ...(captureClass === "physical" && intent.target !== undefined ? { target: intent.target } : {}),
        responsePath: `${intent.out}.response.json`,
        startedAt: "2026-07-18T10:00:01.000+08:00",
        finishedAt: "2026-07-18T10:00:02.000+08:00",
      };
    },
  };
}

describe("US-EVID-030 capture planner e2e — both physical + rendered on one CaptureSet (AC6)", () => {
  it("plans, dispatches, and attaches BOTH receipts to a single CaptureSet, into the manifest and report", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "roll-evid-030-"));
    dirs.push(projectRoot);
    const captureRoot = join(projectRoot, ".roll", "capture-gateway");
    const runDir = join(projectRoot, ".roll", "features", "acceptance-evidence", "US-EVID-030", "run1");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });

    const store = new RollCaptureReceiptStore({ root: captureRoot });
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = {
      declaredUrl: SURFACE,
      expectedAcIds: ["AC2", "AC3"],
      windowApp: "Google Chrome",
      windowTitle: "团队管理",
    };

    const physical = fakeLane("roll-capture-window", 10);
    const rendered = fakeLane("playwright-rendered", 40);

    const result = await planner.capture(surface, { storyId: "US-EVID-030", runId: "run1", runDir, projectRoot }, [physical, rendered], store);

    // AC6: both lanes were dispatched and produced a taken image on ONE CaptureSet.
    expect(result.taken).toHaveLength(2);
    expect(result.taken.map((t) => t.receipt.captureClass).sort()).toEqual(["physical", "rendered"]);
    expect(new Set(result.persisted.map((p) => p.captureSetId)).size).toBe(1);
    expect(result.captureSetId).not.toBeNull();

    // The durable CaptureSet on disk holds BOTH attempts; the first taken is frozen.
    const set = await store.readCaptureSet(result.captureSetId!);
    expect(set?.attempts).toHaveLength(2);
    expect(set?.acceptedReceiptId).not.toBeNull();
    for (const t of result.taken) {
      const onDisk = await store.readReceipt(t.receipt.requestId);
      expect(onDisk).not.toBeNull();
      expect(isAcceptedCaptureReceiptV2(onDisk!, t.intent)).toBe(true);
      // The receipt points at a REAL PNG file that starts with the PNG signature.
      const bytes = readFileSync(onDisk!.screenshotPath!);
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_HEADER);
    }

    // Fold every persisted receipt into the run evidence manifest.
    const facts: CaptureReceiptFact[] = result.persisted.map((p) =>
      captureReceiptFact(p.receipt, p.intent, { runDir, accepted: p.receipt.state === "taken", captureSetId: p.captureSetId }),
    );
    const manifest = await collectEvidence({
      storyId: "US-EVID-030",
      projectPath: projectRoot,
      runDir,
      now: () => "2026-07-18T10:00:03.000+08:00",
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      ghProbe: async () => false,
      captureReceipts: facts,
    });
    writeEvidenceJson(manifest, runDir);

    const onDisk = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as EvidenceManifest;
    expect(onDisk.capture_receipts).toHaveLength(2);
    const classes = onDisk.capture_receipts.map((r) => r.captureClass).sort();
    expect(classes).toEqual(["physical", "rendered"]);
    // Each fact keeps its surface/AC binding and a run-relative screenshot path.
    for (const rf of onDisk.capture_receipts) {
      expect(rf.surfaceId).toBe(SURFACE);
      expect(rf.expectedAcIds).toEqual(["AC2", "AC3"]);
      expect(rf.screenshotPath?.startsWith("screenshots/")).toBe(true);
    }

    // AC6: the report renders BOTH images beneath the shared surface.
    const refs = result.taken
      .map((t) => captureReceiptEvidenceRef(t.receipt))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const html = renderReport({
      storyId: "US-EVID-030",
      title: "Plan and run best-effort visual capture lanes",
      generatedAt: "2026-07-18T10:00:03.000+08:00",
      items: [{ id: "AC2", text: "team surface captured", status: "pass-with-evidence", evidence: refs }],
      selfCaptures: refs,
    });
    expect(html).toContain("Roll Capture · physical");
    expect(html).toContain("Playwright · rendered");
  });
});
