import { describe, expect, it } from "vitest";
import type { BrowserOperationsTimeline } from "@roll/spec";
import { renderBrowserOperationsTimelineHtml } from "../src/lib/browser-ops-timeline.js";
import { renderStoryDossier, type StoryDossierInput } from "../src/lib/story-dossier.js";
import type { DossierStory } from "../src/lib/archive.js";

function story(): DossierStory {
  return {
    id: "US-BROW-013",
    epic: "browser-automation",
    title: "Optional browser operations timeline",
    type: "us",
    delivered: false,
  };
}

function timeline(hasFacts: boolean): BrowserOperationsTimeline {
  if (!hasFacts) {
    return {
      rows: [],
      absences: [
        {
          kind: "operation-start",
          presence: "absent",
          label: "operation start",
          detail: "no browser operation start fact",
        },
      ],
      hasFacts: false,
      collectedAt: "2026-07-15T00:00:00.000Z",
    };
  }
  return {
    rows: [
      {
        kind: "operation-start",
        presence: "present",
        ts: "2026-07-15T00:00:01.000Z",
        label: "operation start",
        runId: "run-1",
      },
      {
        kind: "operation-finish",
        presence: "present",
        ts: "2026-07-15T00:00:10.000Z",
        label: "operation finish",
        detail: "ok",
        runId: "run-1",
        artifact: { kind: "diagnostic", id: "diag-1", label: "console-summary" },
      },
      {
        kind: "physical-capture",
        presence: "present",
        ts: "2026-07-15T00:00:12.000Z",
        label: "physical capture",
        detail: "failed — digest_mismatch",
        runId: "run-1",
        artifact: { kind: "physical-capture", id: "screenshots/capture.png", label: "capture" },
      },
    ],
    absences: [
      {
        kind: "lease-grant",
        presence: "absent",
        label: "lease grant",
        detail: "no owner lease grant fact",
      },
    ],
    hasFacts: true,
    collectedAt: "2026-07-15T00:00:00.000Z",
  };
}

function baseInput(overrides: Partial<StoryDossierInput> = {}): StoryDossierInput {
  return {
    story: story(),
    narrative: {
      asA: "supervisor reviewing a delivery",
      iWant: "a compact browser-operation timeline",
      soThat: "I can understand ordering without raw events",
    },
    ...overrides,
  };
}

describe("US-BROW-013 renderBrowserOperationsTimelineHtml", () => {
  it("returns empty HTML when no browser facts exist (stable empty report)", () => {
    expect(renderBrowserOperationsTimelineHtml(timeline(false))).toBe("");
    expect(renderBrowserOperationsTimelineHtml(undefined)).toBe("");
  });

  it("links diagnostic and capture artifacts only when viewer is authorized with hrefs", () => {
    const authorized = renderBrowserOperationsTimelineHtml(timeline(true), {
      viewerAuthorized: true,
      artifactHrefs: {
        "diag-1": "diagnostics/diag-1.txt",
        "screenshots/capture.png": "screenshots/capture.png",
      },
    });
    expect(authorized).toContain('href="diagnostics/diag-1.txt"');
    expect(authorized).toContain('href="screenshots/capture.png"');
    expect(authorized).toContain('id="browser-operations"');
    expect(authorized).toContain("operation start");
    expect(authorized).toContain("failed — digest_mismatch");
    expect(authorized).toMatchSnapshot();

    const locked = renderBrowserOperationsTimelineHtml(timeline(true), { viewerAuthorized: false });
    expect(locked).not.toContain("<a ");
    expect(locked).toContain("bot-artifact-locked");
    expect(locked).toMatchSnapshot();
  });
});

describe("US-BROW-013 story dossier remains stable without browser facts", () => {
  it("does not inject a timeline section when hasFacts is false", () => {
    const without = renderStoryDossier(baseInput());
    const withEmpty = renderStoryDossier(baseInput({ browserTimeline: timeline(false) }));
    expect(without).not.toContain("browser-operations");
    expect(withEmpty).not.toContain("browser-operations");
    expect(withEmpty).toContain("暂无周期");
  });

  it("renders the timeline inside Execution when facts exist", () => {
    const html = renderStoryDossier(
      baseInput({
        browserTimeline: timeline(true),
        browserTimelineArtifactHrefs: { "diag-1": "diagnostics/diag-1.txt" },
      }),
    );
    expect(html).toContain('id="browser-operations"');
    expect(html).toContain("browser-ops-timeline");
    expect(html).toContain('href="diagnostics/diag-1.txt"');
    expect(html).toContain("bot-artifact-locked");
  });
});
