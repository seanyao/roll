/**
 * US-EVID-020 — contract projection + frozen hash.
 *
 * The projection is the design-owned acceptance contract: evidence-surface
 * frontmatter + the SET of AC criteria texts. Completion CLAIMS (checkbox state,
 * ✅ tick, Status line, Delivery/narrative sections) are EXCLUDED so the stale-
 * claim reset never reads as contract drift. These pins lock both directions:
 * excluded edits keep the hash stable; contract edits move it.
 */
import { describe, expect, it } from "vitest";
import {
  buildContractSnapshot,
  canonicalizeProjection,
  contractMatchesSnapshot,
  contractProjection,
  contractProjectionHash,
} from "../src/attest/contract-projection.js";

const STORY = "US-EVID-020";

const BASE = `---
id: US-EVID-020
title: t
deliverable_cmd: roll cycles
screenshot_exempt: backend contract; evidence is unit tests
---

# US-EVID-020 — t

## Acceptance Criteria

- [ ] AC1 projection captures the evidence frontmatter and AC set
- [ ] AC2 checkbox state / status / narrative changes do not move the hash
`;

describe("contractProjection", () => {
  it("captures evidence frontmatter and the AC text set", () => {
    const p = contractProjection(BASE, STORY);
    expect(p.deliverableCmd).toBe("roll cycles");
    expect(p.screenshotExempt).toBe("backend contract; evidence is unit tests");
    expect(p.deliverableUrl).toBeNull();
    expect(p.acTexts).toEqual([
      "AC1 projection captures the evidence frontmatter and AC set",
      "AC2 checkbox state / status / narrative changes do not move the hash",
    ]);
  });

  it("is order-independent over AC texts (sorted set identity)", () => {
    const swapped = BASE.replace(
      /- \[ \] AC1[^\n]*\n- \[ \] AC2[^\n]*/,
      "- [ ] AC2 checkbox state / status / narrative changes do not move the hash\n- [ ] AC1 projection captures the evidence frontmatter and AC set",
    );
    expect(contractProjectionHash(swapped, STORY)).toBe(contractProjectionHash(BASE, STORY));
  });

  it("prefers deliverable_url but falls back to screenshot_url alias", () => {
    const withUrl = BASE.replace("deliverable_cmd: roll cycles", "screenshot_url: https://app.test/x#y");
    expect(contractProjection(withUrl, STORY).deliverableUrl).toBe("https://app.test/x#y");
  });

  it("strips a whitespace-preceded YAML comment but keeps an unspaced '#' (URL fragment)", () => {
    const commented = BASE.replace("deliverable_cmd: roll cycles", "deliverable_cmd: roll cycles # note");
    expect(contractProjection(commented, STORY).deliverableCmd).toBe("roll cycles");
    const frag = BASE.replace("deliverable_cmd: roll cycles", "deliverable_url: .roll/features/index.html#loop");
    expect(contractProjection(frag, STORY).deliverableUrl).toBe(".roll/features/index.html#loop");
  });

  it("unwraps surrounding quotes on a scalar value", () => {
    const quoted = BASE.replace("deliverable_cmd: roll cycles", 'deliverable_cmd: "roll cycles"');
    expect(contractProjection(quoted, STORY).deliverableCmd).toBe("roll cycles");
  });

  it("parses a CRLF spec identically to LF (no silent null frontmatter)", () => {
    expect(contractProjectionHash(BASE.replace(/\n/g, "\r\n"), STORY)).toBe(contractProjectionHash(BASE, STORY));
  });

  it("treats AC texts as a true set (duplicate criterion lines dedupe)", () => {
    const dup = BASE.replace(
      "- [ ] AC2 checkbox state / status / narrative changes do not move the hash\n",
      "- [ ] AC2 checkbox state / status / narrative changes do not move the hash\n- [ ] AC1 projection captures the evidence frontmatter and AC set\n",
    );
    expect(contractProjection(dup, STORY).acTexts).toEqual(contractProjection(BASE, STORY).acTexts);
  });
});

describe("contractProjectionHash — EXCLUDED completion claims keep the hash stable", () => {
  it("checkbox state flip [ ]→[x] does not change the hash", () => {
    const checked = BASE.replace(/- \[ \]/g, "- [x]");
    expect(contractProjectionHash(checked, STORY)).toBe(contractProjectionHash(BASE, STORY));
  });

  it("adding a ✅ tick / **Status** line / Delivery section does not change the hash", () => {
    const claimed =
      BASE.replace("# US-EVID-020 — t", "# US-EVID-020 — t ✅") +
      "\n**Status**: ✅ Done\n\n**Delivery notes**\n- shipped in PR #999\n";
    expect(contractProjectionHash(claimed, STORY)).toBe(contractProjectionHash(BASE, STORY));
  });
});

describe("contractProjectionHash — CONTRACT edits move the hash", () => {
  it("changing an AC criterion text changes the hash", () => {
    const edited = BASE.replace("AC1 projection captures", "AC1 WEAKENED captures");
    expect(contractProjectionHash(edited, STORY)).not.toBe(contractProjectionHash(BASE, STORY));
  });

  it("injecting screenshot_exempt where there was none changes the hash (the builder self-exempt hole)", () => {
    const noExempt = BASE.replace("screenshot_exempt: backend contract; evidence is unit tests\n", "");
    expect(contractProjectionHash(noExempt, STORY)).not.toBe(contractProjectionHash(BASE, STORY));
  });

  it("is deterministic — identical contract yields identical hash", () => {
    expect(contractProjectionHash(BASE, STORY)).toBe(contractProjectionHash(BASE, STORY));
    expect(canonicalizeProjection(contractProjection(BASE, STORY))).toBe(
      canonicalizeProjection(contractProjection(BASE, STORY)),
    );
  });
});

describe("buildContractSnapshot / contractMatchesSnapshot — freeze at cycle start", () => {
  it("freezes hash + projection + frozenAt", () => {
    const snap = buildContractSnapshot(BASE, STORY, 1783580000000);
    expect(snap.storyId).toBe(STORY);
    expect(snap.hash).toBe(contractProjectionHash(BASE, STORY));
    expect(snap.frozenAt).toBe(1783580000000);
    expect(snap.projection.deliverableCmd).toBe("roll cycles");
  });

  it("matches when a later spec keeps the same contract (checkbox flip is not drift)", () => {
    const snap = buildContractSnapshot(BASE, STORY, 1);
    const reset = BASE.replace(/- \[ \]/g, "- [x]"); // resetSpecTruthText-style claim flip
    expect(contractMatchesSnapshot(snap, reset)).toBe(true);
  });

  it("detects drift when a later spec injects screenshot_exempt or weakens an AC", () => {
    const snap = buildContractSnapshot(BASE.replace("screenshot_exempt: backend contract; evidence is unit tests\n", ""), STORY, 1);
    expect(contractMatchesSnapshot(snap, BASE)).toBe(false); // exempt injected after freeze
    const weakened = BASE.replace("AC1 projection captures", "AC1 gutted");
    expect(contractMatchesSnapshot(buildContractSnapshot(BASE, STORY, 1), weakened)).toBe(false);
  });
});
