import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureIntentV2, CaptureReceiptV2 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V1, ROLL_CAPTURE_PROTOCOL_V2 } from "@roll/spec";
import {
  RollCaptureReceiptStore,
  captureHostAdvertisementPath,
  negotiateRollCaptureProtocol,
  readCaptureHostAdvertisement,
} from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env["ROLL_NO_SCREENCAP"];
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-capture-receipt-"));
  dirs.push(dir);
  return dir;
}

const projectRoot = resolve("/repo");
const SURFACE = "http://localhost:3000/team";
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;

function intent(overrides: Partial<CaptureIntentV2> = {}): CaptureIntentV2 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: "US-PHYSICAL-009-run1-team",
    storyId: "US-PHYSICAL-009",
    runId: "run1",
    surface: { id: SURFACE, declaredUrl: SURFACE, expectedAcIds: ["AC2"] },
    operation: "capture-window",
    source: "roll-capture-window",
    target: { appName: "Google Chrome", windowTitle: "团队管理" },
    out: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/screenshots/physical.png"),
    timeoutMs: 60_000,
    createdAt: "2026-07-18T10:00:00.000+08:00",
    ...overrides,
  };
}

function receipt(overrides: Partial<CaptureReceiptV2> = {}): CaptureReceiptV2 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: "US-PHYSICAL-009-run1-team",
    storyId: "US-PHYSICAL-009",
    runId: "run1",
    surfaceId: SURFACE,
    source: "roll-capture-window",
    captureClass: "physical",
    state: "taken",
    screenshotPath: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/screenshots/physical.png"),
    sha256: SHA_A,
    target: { appName: "Google Chrome", windowTitle: "团队管理" },
    responsePath: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/response.json"),
    startedAt: "2026-07-18T10:00:01.000+08:00",
    finishedAt: "2026-07-18T10:00:02.000+08:00",
    ...overrides,
  };
}

describe("US-PHYSICAL-009 RollCaptureReceiptStore (AC4)", () => {
  it("persists an accepted receipt and returns it as accepted", async () => {
    const store = new RollCaptureReceiptStore({ root: tempRoot() });
    const r = await store.persistReceipt(intent(), receipt());
    expect(r.status).toBe("persisted");
    expect(r.status === "persisted" && r.accepted).toBe(true);
    expect(await store.readReceipt(receipt().requestId)).toEqual(receipt());
    expect(await store.readAcceptedReceipt(receipt())).toEqual(receipt());
  });

  it("returns the persisted receipt for a duplicate request id with identical content", async () => {
    const store = new RollCaptureReceiptStore({ root: tempRoot() });
    await store.persistReceipt(intent(), receipt());
    // Same content but different transport/timing fields → still a duplicate.
    const again = await store.persistReceipt(intent(), receipt({ startedAt: "2026-07-18T11:00:00.000+08:00", responsePath: resolve(projectRoot, ".roll/x.json") }));
    expect(again.status).toBe("duplicate");
    expect(again.status === "duplicate" && again.receipt.sha256).toBe(SHA_A);
  });

  it("REJECTS a duplicate request id with DIFFERENT content and never overwrites the taken receipt", async () => {
    const root = tempRoot();
    const store = new RollCaptureReceiptStore({ root });
    await store.persistReceipt(intent(), receipt());
    const path = store.receiptPath(receipt().requestId);
    const before = readFileSync(path, "utf8");

    const rejected = await store.persistReceipt(intent(), receipt({ sha256: SHA_B }));
    expect(rejected.status).toBe("rejected");
    expect(rejected.status === "rejected" && rejected.reason).toContain("duplicate_request_id_different_content");
    // The prior taken artifact on disk is untouched.
    expect(readFileSync(path, "utf8")).toBe(before);
    expect((await store.readReceipt(receipt().requestId))?.sha256).toBe(SHA_A);
  });

  it("records a retry (new attempt id, same CaptureSet) WITHOUT overwriting the accepted taken receipt", async () => {
    const store = new RollCaptureReceiptStore({ root: tempRoot() });
    await store.persistReceipt(intent(), receipt());
    const retryIntent = intent({ requestId: "US-PHYSICAL-009-run1-team-2" });
    const retry = await store.persistReceipt(retryIntent, receipt({ requestId: "US-PHYSICAL-009-run1-team-2", sha256: SHA_B }));
    expect(retry.status).toBe("persisted");
    // New attempt is recorded, but the accepted receipt is FROZEN to the first one.
    expect(retry.status === "persisted" && retry.accepted).toBe(false);
    const set = await store.readCaptureSet(store.captureSetId(receipt()));
    expect(set?.attempts).toEqual(["US-PHYSICAL-009-run1-team", "US-PHYSICAL-009-run1-team-2"]);
    expect(set?.acceptedReceiptId).toBe("US-PHYSICAL-009-run1-team");
    expect((await store.readAcceptedReceipt(receipt()))?.sha256).toBe(SHA_A);
  });

  it("rejects malformed / mismatched / missing-artifact receipts BEFORE writing anything", async () => {
    const store = new RollCaptureReceiptStore({ root: tempRoot() });
    const missing = await store.persistReceipt(intent(), receipt({ screenshotPath: undefined }));
    expect(missing.status).toBe("rejected");
    const mismatch = await store.persistReceipt(intent(), receipt({ surfaceId: "http://localhost:3000/nope" }));
    expect(mismatch.status).toBe("rejected");
    // Nothing was written for a rejected receipt.
    expect(await store.readReceipt(receipt().requestId)).toBeNull();
  });
});

describe("US-PHYSICAL-009 host advertisement negotiation (AC1)", () => {
  it("reads an advertisement file and negotiates v2 available", async () => {
    const root = tempRoot();
    writeFileSync(captureHostAdvertisementPath(root), JSON.stringify({ protocols: [ROLL_CAPTURE_PROTOCOL_V1, ROLL_CAPTURE_PROTOCOL_V2], hostVersion: "2.0.0" }));
    const adv = await readCaptureHostAdvertisement(root);
    expect(adv?.protocols).toContain(ROLL_CAPTURE_PROTOCOL_V2);
    const n = await negotiateRollCaptureProtocol(root);
    expect(n.v2.available).toBe(true);
    expect(n.selected).toBe(ROLL_CAPTURE_PROTOCOL_V2);
  });

  it("treats a MISSING advertisement file as a legacy host and never guesses v2", async () => {
    const root = tempRoot();
    expect(await readCaptureHostAdvertisement(root)).toBeNull();
    const n = await negotiateRollCaptureProtocol(root);
    expect(n.v2.available).toBe(false);
    expect(n.v2).toMatchObject({ available: false, reason: expect.stringContaining("never assumed") });
  });

  it("treats a malformed advertisement file as a legacy host (null), never guessing v2", async () => {
    const root = tempRoot();
    writeFileSync(captureHostAdvertisementPath(root), "{ this is : not json");
    expect(await readCaptureHostAdvertisement(root)).toBeNull();
    expect((await negotiateRollCaptureProtocol(root)).v2.available).toBe(false);
  });
});

describe("US-PHYSICAL-009 ROLL_NO_SCREENCAP does not gate the gateway (AC3)", () => {
  it("persists a v2 receipt even when ROLL_NO_SCREENCAP=1 is set", async () => {
    process.env["ROLL_NO_SCREENCAP"] = "1";
    const store = new RollCaptureReceiptStore({ root: tempRoot() });
    const r = await store.persistReceipt(intent(), receipt());
    expect(r.status).toBe("persisted");
  });

  it("the v2 transport source NEVER READS the ROLL_NO_SCREENCAP switch", () => {
    // Guard: the gateway lane must not consult the Runner-native ban switch.
    // Mentions in comments are fine; an actual env read (quoted key or property
    // access) is not — that would let an ambient switch gate the gateway.
    const src = readFileSync(new URL("../src/roll-capture.ts", import.meta.url), "utf8");
    expect(src).not.toContain('ROLL_NO_SCREENCAP"');
    expect(src).not.toContain(".ROLL_NO_SCREENCAP");
    expect(src).not.toMatch(/env\s*\[\s*['"`]ROLL_NO_SCREENCAP/u);
  });
});
