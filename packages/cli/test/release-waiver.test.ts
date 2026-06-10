/**
 * US-TRUTH-005 — `roll release waiver`: the recorded bypass.
 */
import { describe, expect, it } from "vitest";
import { releaseWaiverCommand } from "../src/commands/release-waiver.js";

describe("roll release waiver", () => {
  it("records reason/scope/expiry/operator/ts into the fact stream", () => {
    const events: Array<Record<string, unknown>> = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture
    process.stdout.write = (): boolean => true;
    let rc: number;
    try {
      rc = releaseWaiverCommand(["--reason", "hotfix window", "--scope", "done-no-merge", "--days", "2"], {
        nowSec: 1000,
        operator: "owner",
        append: (_c, e) => events.push(e as Record<string, unknown>),
      });
    } finally {
      process.stdout.write = realWrite;
    }
    expect(rc).toBe(0);
    expect(events[0]).toEqual({
      type: "release:waiver",
      reason: "hotfix window",
      scope: "done-no-merge",
      expiresSec: 1000 + 2 * 86400,
      operator: "owner",
      ts: 1000,
    });
  });

  it("a waiver without reason/scope/expiry is not a waiver — usage + exit 1", () => {
    const realErr = process.stderr.write.bind(process.stderr);
    let err = "";
    // @ts-expect-error capture
    process.stderr.write = (s: string): boolean => ((err += String(s)), true);
    let rc: number;
    try {
      rc = releaseWaiverCommand(["--reason", "", "--scope", "all"], { append: () => {} });
    } finally {
      process.stderr.write = realErr;
    }
    expect(rc).toBe(1);
    expect(err).toContain("--days");
  });
});
