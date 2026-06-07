import { describe, expect, it } from "vitest";
import { planShip, type ShipFacts } from "../src/release/ship.js";

const ok: ShipFacts = {
  currentVersion: "3.608.1",
  branch: "main",
  clean: true,
  syncedWithOrigin: true,
  tagExists: false,
  consistencyPass: true,
  defaultBranch: "main",
};

describe("planShip — release tag-push gate", () => {
  it("all preconditions met → ok, tag = v<currentVersion>", () => {
    const p = planShip(ok);
    expect(p.ok).toBe(true);
    expect(p.tag).toBe("v3.608.1");
    expect(p.blockers).toEqual([]);
  });

  it("off the default branch → blocked", () => {
    expect(planShip({ ...ok, branch: "feat/x" }).blockers).toContain("not-default-branch");
  });

  it("dirty tree → blocked", () => {
    expect(planShip({ ...ok, clean: false }).blockers).toContain("dirty-tree");
  });

  it("out of sync with origin → blocked", () => {
    expect(planShip({ ...ok, syncedWithOrigin: false }).blockers).toContain("out-of-sync");
  });

  it("tag already exists → blocked (no double release)", () => {
    expect(planShip({ ...ok, tagExists: true }).blockers).toContain("tag-exists");
  });

  it("consistency gate red → blocked (never ship with a gap)", () => {
    expect(planShip({ ...ok, consistencyPass: false }).blockers).toContain("consistency-failed");
  });

  it("multiple failures accumulate, ok stays false", () => {
    const p = planShip({ ...ok, branch: "x", clean: false, consistencyPass: false });
    expect(p.ok).toBe(false);
    expect(p.blockers.length).toBe(3);
    expect(p.tag).toBe("v3.608.1"); // tag still computed for the message
  });
});
