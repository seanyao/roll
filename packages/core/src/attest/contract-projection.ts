/**
 * US-EVID-020 — the acceptance-contract PROJECTION + frozen hash.
 *
 * The attest gate today reads the acceptance contract (AC text + evidence
 * frontmatter) from the builder-writable worktree spec, so a builder can add
 * `screenshot_exempt` or weaken an AC mid-cycle and the gate honours it. The fix
 * (US-EVID-021) is to judge against a snapshot frozen at cycle start; THIS module
 * is the pure projection + deterministic hash that snapshot is built from.
 *
 * The projection is deliberately NARROW — it is the contract the designer owns:
 *   - the evidence-surface frontmatter (`deliverable_url` / `deliverable_cmd` /
 *     `screenshot_exempt`), and
 *   - the SET of AC criteria TEXTS (order-independent).
 *
 * Everything that is a "completion CLAIM" rather than the contract is EXCLUDED,
 * so the existing stale-claim reset (`resetSpecTruthText`, which flips `[x]→[ ]`
 * and strips ✅/Status/Delivery/narrative) never registers as contract drift:
 *   - checkbox STATE — `AcItem.checked` is never read here (only `.text`);
 *   - the `**Status**` line, the H1 `✅` tick, Delivery/Fixed sections, and the
 *     Problem/Root Cause/Solution narrative — none live in the frontmatter or an
 *     AC criterion text, so they are structurally outside the projection.
 *
 * Pure: string(s) → value. No filesystem, no clock. Unit-tested directly.
 */
import { createHash } from "node:crypto";
import { acForStory } from "./ac-parser.js";

export interface ContractProjection {
  /** `deliverable_url:` (alias `screenshot_url:`) value, or null when absent. */
  deliverableUrl: string | null;
  /** `deliverable_cmd:` value, or null when absent. */
  deliverableCmd: string | null;
  /** `screenshot_exempt:` reason value, or null when absent. */
  screenshotExempt: string | null;
  /** AC criteria texts, trimmed and SORTED so ordering is not part of identity. */
  acTexts: readonly string[];
}

/** The spec frontmatter block body (between the leading `---` fences), or null. */
function frontmatterBlock(specText: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(specText);
  return m === null ? null : (m[1] ?? "");
}

/** A single frontmatter scalar value (trimmed), or null when absent/empty. */
function frontmatterValue(specText: string, key: string): string | null {
  const fm = frontmatterBlock(specText);
  if (fm === null) return null;
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fm);
  if (m === null) return null;
  const value = (m[1] ?? "").trim();
  return value === "" ? null : value;
}

/**
 * Project a story spec down to its design-owned acceptance contract. `storyId`
 * scopes which AC block is read; `fileOwned` mirrors the attest gate so a
 * one-card FIX/US file with a file-level AC block is read the same way.
 */
export function contractProjection(specText: string, storyId: string): ContractProjection {
  const acTexts = acForStory(specText, storyId, { fileOwned: true })
    .map((it) => it.text.trim())
    .filter((text) => text !== "")
    .sort();
  return {
    deliverableUrl:
      frontmatterValue(specText, "deliverable_url") ?? frontmatterValue(specText, "screenshot_url"),
    deliverableCmd: frontmatterValue(specText, "deliverable_cmd"),
    screenshotExempt: frontmatterValue(specText, "screenshot_exempt"),
    acTexts,
  };
}

/**
 * Canonical string form of a projection — stable key order so the hash is
 * deterministic for a given contract regardless of how the fields were built.
 */
export function canonicalizeProjection(projection: ContractProjection): string {
  return JSON.stringify({
    deliverableUrl: projection.deliverableUrl,
    deliverableCmd: projection.deliverableCmd,
    screenshotExempt: projection.screenshotExempt,
    acTexts: projection.acTexts,
  });
}

/** SHA-256 of the canonical projection — the frozen contract hash. */
export function contractProjectionHash(specText: string, storyId: string): string {
  return createHash("sha256")
    .update(canonicalizeProjection(contractProjection(specText, storyId)), "utf8")
    .digest("hex");
}

/**
 * The frozen contract snapshot taken at cycle start. `hash` is the identity the
 * attest gate (US-EVID-021) judges against; `projection` is the readable content
 * behind that hash; `frozenAt` is the cycle-start clock (ms) the caller stamps.
 */
export interface ContractSnapshot {
  storyId: string;
  hash: string;
  projection: ContractProjection;
  frozenAt: number;
}

/**
 * Freeze a story's contract into a snapshot. PURE — the caller supplies the
 * spec text (read from design truth, NOT a builder-mutable worktree copy) and
 * the cycle-start timestamp. The snapshot is what downstream freezes against;
 * a later worktree/HEAD projection that hashes differently is contract drift.
 */
export function buildContractSnapshot(
  specText: string,
  storyId: string,
  frozenAtMs: number,
): ContractSnapshot {
  const projection = contractProjection(specText, storyId);
  return {
    storyId,
    hash: createHash("sha256").update(canonicalizeProjection(projection), "utf8").digest("hex"),
    projection,
    frozenAt: frozenAtMs,
  };
}

/**
 * Does a (possibly later) spec still match the frozen snapshot's contract?
 * `true` ⇒ no drift; `false` ⇒ the AC set or evidence surface was changed after
 * the freeze (the builder-self-exempt / AC-weakening hole US-EVID-021 closes).
 */
export function contractMatchesSnapshot(snapshot: ContractSnapshot, specText: string): boolean {
  return contractProjectionHash(specText, snapshot.storyId) === snapshot.hash;
}
