/**
 * REFACTOR-047: the backlog status state machine is single-source and strongly
 * typed. `classifyStatus` is the ONE parser from a raw markdown status cell to
 * the `StoryStatus` enum; `STATUS_MARKER` is the ONE canonical marker per state.
 * No consumer may re-derive status by ad-hoc substring matching.
 */
import { describe, expect, it } from "vitest";
import { classifyStatus, STATUS_MARKER, type StoryStatus } from "../src/types/story.js";

describe("STATUS_MARKER ↔ classifyStatus round-trip", () => {
  it("every canonical marker classifies back to its own status", () => {
    const statuses: StoryStatus[] = ["todo", "in_progress", "done", "hold"];
    for (const s of statuses) {
      expect(classifyStatus(STATUS_MARKER[s])).toBe(s);
    }
  });
});

describe("classifyStatus", () => {
  it("recognizes canonical data markers (incl. 🚫 Hold the v2 renderer was blind to)", () => {
    expect(classifyStatus("📋 Todo")).toBe("todo");
    expect(classifyStatus("🔨 In Progress")).toBe("in_progress");
    expect(classifyStatus("✅ Done")).toBe("done");
    expect(classifyStatus("🚫 Hold (claude 直做并行)")).toBe("hold");
  });

  it("folds historical triage markers 🔒 Blocked / ⏸ Deferred into hold", () => {
    expect(classifyStatus("🔒 Blocked [needs api key]")).toBe("hold");
    expect(classifyStatus("⏸ Deferred [v2-freeze]")).toBe("hold");
  });

  it("checks terminal states before Todo so a Done row with a Todo note is not pending", () => {
    expect(classifyStatus("✅ Done — superseded a 📋 Todo note")).toBe("done");
  });

  it("keys on the leading marker, not status WORDS buried in the reason text", () => {
    // Real regression: US-PORT-021's hold reason mentions "全 Done 后" — a loose
    // includes("Done") misclassified it as done and the row vanished from view.
    expect(classifyStatus("🚫 Hold (待 013~020+022 全 Done 后 owner 确认放行)")).toBe("hold");
    expect(classifyStatus("🔨 In Progress (blocks the Done rollup)")).toBe("in_progress");
    expect(classifyStatus("📋 Todo (not Done yet)")).toBe("todo");
  });

  it("returns null for an unrecognized cell (fail-loud, no silent drop)", () => {
    expect(classifyStatus("🚧 部分")).toBeNull();
    expect(classifyStatus("")).toBeNull();
  });
});
