/**
 * REFACTOR-047: the backlog status state machine is single-source and strongly
 * typed. `classifyStatus` is the ONE parser from a raw markdown status cell to
 * the `StoryStatus` enum; `STATUS_MARKER` is the ONE canonical marker per state.
 * No consumer may re-derive status by ad-hoc substring matching.
 */
import { describe, expect, it } from "vitest";
import {
  AWAITING_REVIEW_STATUS_MARKER,
  classifyStatus,
  findStatusMarker,
  LEGACY_STATUS_MARKERS,
  STATUS_MARKER,
  statusMarkerRe,
  type StoryStatus,
} from "../src/types/story.js";

describe("STATUS_MARKER ↔ classifyStatus round-trip", () => {
  it("every canonical marker classifies back to its own status", () => {
    const statuses: StoryStatus[] = ["todo", "in_progress", "done", "hold", "cut"];
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

  it("FIX-909: ⏳ 待复评 is visible but re-pickable, not Hold/Done", () => {
    expect(classifyStatus(AWAITING_REVIEW_STATUS_MARKER)).toBe("todo");
    expect(findStatusMarker(`| FIX-909 | x | ${AWAITING_REVIEW_STATUS_MARKER} |`)).toBe(AWAITING_REVIEW_STATUS_MARKER);
  });

  it("recognizes Cut as a terminal status distinct from an unknown cell", () => {
    expect(classifyStatus("🗑️ Cut (superseded by US-OBS-018)")).toBe("cut");
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
    // 🚧 is now a recognized legacy WIP marker (FIX-300), so a genuinely
    // unknown glyph must be used to exercise the fail-loud null path.
    expect(classifyStatus("❓ 未知")).toBeNull();
    expect(classifyStatus("")).toBeNull();
  });
});

describe("FIX-300 single-source markers — legacy tolerance", () => {
  it("classifies the divergent showcase legacy markers onto canonical statuses", () => {
    // These are exactly the markers the old showcase reset regex used, which
    // classifyStatus / the picker / the renderer were blind to before FIX-300.
    expect(classifyStatus("🚧 WIP")).toBe("in_progress");
    expect(classifyStatus("🔄 In Progress")).toBe("in_progress");
    expect(classifyStatus("⏳ Hold")).toBe("hold");
    expect(classifyStatus("✔️ Done")).toBe("done");
  });

  it("LEGACY_STATUS_MARKERS each round-trip through classifyStatus to their status", () => {
    for (const { marker, status } of LEGACY_STATUS_MARKERS) {
      expect(classifyStatus(marker)).toBe(status);
    }
  });
});

describe("FIX-300 single-source markers — regex / extractor", () => {
  it("the regex matches every canonical marker", () => {
    const statuses: StoryStatus[] = ["todo", "in_progress", "done", "hold", "cut"];
    for (const s of statuses) {
      expect(statusMarkerRe(false).test(`| ${STATUS_MARKER[s]} |`)).toBe(true);
    }
  });

  it("the regex matches every legacy marker", () => {
    for (const { marker } of LEGACY_STATUS_MARKERS) {
      expect(statusMarkerRe(false).test(`| ${marker} |`)).toBe(true);
    }
  });

  it("findStatusMarker extracts and normalizes the marker token from a row", () => {
    expect(findStatusMarker("| [US-1](x) | desc | ✅ Done |")).toBe("✅ Done");
    // Tolerates extra inter-glyph whitespace and normalizes back to one space.
    expect(findStatusMarker("| [US-1](x) | desc | 📋  Todo |")).toBe("📋 Todo");
    // Legacy marker is still extracted (not dropped).
    expect(findStatusMarker("| [US-1](x) | desc | ⏳ Hold |")).toBe("⏳ Hold");
  });

  it("findStatusMarker returns undefined for a row with no recognized marker", () => {
    expect(findStatusMarker("| [US-1](x) | desc | ❓ 未知 |")).toBeUndefined();
  });

  it("does not match a status WORD buried in the reason text without a glyph", () => {
    // The hold reason mentions Done but carries no marker glyph — must not match.
    expect(findStatusMarker("| [US-1](x) | desc | done-ish note |")).toBeUndefined();
  });
});

describe("FIX-300 single-source markers — cross-module agreement", () => {
  it("every canonical marker is recognized identically by classifyStatus and the regex", () => {
    const statuses: StoryStatus[] = ["todo", "in_progress", "done", "hold", "cut"];
    for (const s of statuses) {
      const marker = STATUS_MARKER[s];
      expect(classifyStatus(marker)).toBe(s);
      expect(findStatusMarker(`| x | y | ${marker} |`)).toBe(marker);
    }
  });
});
