/**
 * US-PHYSICAL-009 (AC2 + AC5) — integration fixture.
 *
 * Proves a Capture Gateway v2 PHYSICAL receipt survives every package boundary:
 *   spec (validate) → infra (persist + manifest) → core (report attachment).
 * There is no live Capture.app here (that is external card US-CAPTURE-017); the
 * receipt is a fixture, exactly as the card's screenshot_exempt reason allows.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureIntentV2, CaptureReceiptV2 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V2, isAcceptedCaptureReceiptV2 } from "@roll/spec";
import {
  RollCaptureReceiptStore,
  captureReceiptFact,
  collectEvidence,
  writeEvidenceJson,
  type CaptureReceiptFact,
  type EvidenceManifest,
} from "@roll/infra";
import { captureReceiptEvidenceRef, renderReport } from "@roll/core";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const SURFACE = "http://localhost:3000/team";

describe("US-PHYSICAL-009 v2 physical receipt reaches manifest + report attachment path", () => {
  it("crosses spec → infra (store + manifest) → core (report) with identity, source class, and digest intact", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "roll-v2-integration-"));
    dirs.push(projectRoot);
    const captureRoot = join(projectRoot, ".roll", "capture-gateway");
    const runDir = join(projectRoot, ".roll", "features", "capture-tool", "US-PHYSICAL-009", "run1");
    const screenshotsDir = join(runDir, "screenshots");
    mkdirSync(screenshotsDir, { recursive: true });

    // A real PNG on disk, digested the way Roll Capture would.
    const shotPath = join(screenshotsDir, "physical.png");
    writeFileSync(shotPath, PNG_BYTES);
    const sha256 = `sha256:${createHash("sha256").update(PNG_BYTES).digest("hex")}`;

    const intent: CaptureIntentV2 = {
      protocol: ROLL_CAPTURE_PROTOCOL_V2,
      requestId: "US-PHYSICAL-009-run1-team",
      storyId: "US-PHYSICAL-009",
      runId: "run1",
      surface: { id: SURFACE, declaredUrl: SURFACE, expectedAcIds: ["AC2", "AC3"] },
      operation: "capture-window",
      source: "roll-capture-window",
      target: { appName: "Google Chrome", windowTitle: "团队管理" },
      out: shotPath,
      timeoutMs: 60_000,
      createdAt: "2026-07-18T10:00:00.000+08:00",
    };
    const receipt: CaptureReceiptV2 = {
      protocol: ROLL_CAPTURE_PROTOCOL_V2,
      requestId: intent.requestId,
      storyId: intent.storyId,
      runId: intent.runId,
      surfaceId: SURFACE,
      source: "roll-capture-window",
      captureClass: "physical",
      state: "taken",
      screenshotPath: shotPath,
      sha256,
      target: { appName: "Google Chrome", windowTitle: "团队管理" },
      responsePath: join(captureRoot, "receipts", `receipt-${intent.requestId}.json`),
      startedAt: "2026-07-18T10:00:01.000+08:00",
      finishedAt: "2026-07-18T10:00:02.000+08:00",
    };
    expect(isAcceptedCaptureReceiptV2(receipt, intent)).toBe(true);

    // infra: persist through the durable store.
    const store = new RollCaptureReceiptStore({ root: captureRoot });
    const persisted = await store.persistReceipt(intent, receipt);
    expect(persisted.status).toBe("persisted");
    expect(persisted.status === "persisted" && persisted.accepted).toBe(true);

    // infra: fold into the run evidence manifest (AC2).
    const fact: CaptureReceiptFact = captureReceiptFact(persisted.status === "rejected" ? receipt : persisted.receipt, intent, {
      runDir,
      accepted: persisted.status !== "rejected" && persisted.accepted,
      captureSetId: persisted.status !== "rejected" ? persisted.captureSetId : undefined,
    });
    const manifest = await collectEvidence({
      storyId: "US-PHYSICAL-009",
      projectPath: projectRoot,
      runDir,
      now: () => "2026-07-18T10:00:03.000+08:00",
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      ghProbe: async () => false,
      captureReceipts: [fact],
    });
    writeEvidenceJson(manifest, runDir);

    // AC2: identity, source class, digest, surface/AC binding survived to disk.
    const onDisk = JSON.parse(readFileSync(join(runDir, "evidence.json"), "utf8")) as EvidenceManifest;
    expect(onDisk.capture_receipts).toHaveLength(1);
    const rf = onDisk.capture_receipts[0]!;
    expect(rf).toMatchObject({
      protocol: "roll.capture.v2",
      requestId: "US-PHYSICAL-009-run1-team",
      surfaceId: SURFACE,
      source: "roll-capture-window",
      captureClass: "physical",
      state: "taken",
      sha256,
      expectedAcIds: ["AC2", "AC3"],
      accepted: true,
      screenshotPath: "screenshots/physical.png",
    });

    // AC5: the receipt's PNG reaches the report attachment path.
    const ref = captureReceiptEvidenceRef(persisted.status === "rejected" ? receipt : persisted.receipt);
    expect(ref).not.toBeNull();
    const html = renderReport({
      storyId: "US-PHYSICAL-009",
      title: "Negotiate Capture Gateway v2 receipts",
      generatedAt: "2026-07-18T10:00:03.000+08:00",
      items: [{ id: "AC2", text: "physical capture bound to /team", status: "pass-with-evidence", evidence: ref !== null ? [ref] : [] }],
      selfCaptures: ref !== null ? [ref] : [],
    });
    expect(html).toContain('src="screenshots/physical.png"');
    expect(html).toContain("Roll Capture · physical");

    // The accepted receipt is retrievable and frozen in the CaptureSet.
    const accepted = await store.readAcceptedReceipt(receipt);
    expect(accepted?.sha256).toBe(sha256);
  });
});
