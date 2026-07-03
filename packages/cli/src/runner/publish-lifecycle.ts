import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { parseBacklog, type CycleContext } from "@roll/core";
import { cardArchiveDir } from "../lib/archive.js";
import { validateStoryVisualEvidence } from "../lib/design-visual-evidence.js";
import { acMapPath } from "./attest-remediation.js";
import { declaresAnySurface, screenshotExemption } from "./attest-gate.js";
import type { Ports } from "./ports.js";
import { eventTs } from "./runner-time.js";

/**
 * FIX-311b — the BUILD-PREFLIGHT visual-evidence gate, run inside `pick_story`
 * AFTER the spec-truth reset and BEFORE the agent spawns. It is the shift-left
 * of the FIX-309 attest gate: catch a spec that can NEVER satisfy the runtime
 * screenshot floor at the cheapest possible moment (before a whole build cycle
 * honest-skips) rather than at delivery.
 *
 * CONSERVATIVE BY CONTRACT (owner red line: 误杀 CLI/后端卡 = 阻断 loop, 绝不可):
 *   - It NEVER alters control flow — the caller's `story_picked` still returns
 *     regardless. A false positive can therefore NOT topple a CLI/back-end card;
 *     it only raises a visible, auditable signal (an ALERT + a `visual:gate`
 *     event).
 *   - It fails-loud ONLY when CONFIDENT (the verdict's `ok` is false): a clear
 *     WEB-surface card with no declared `deliverable_url`
 *     (`web-surface-without-deliverable-url`), or a card with NO visual-evidence
 *     AC and NO recorded `screenshot_exempt` (`missing-visual-evidence-ac`). A
 *     TERMINAL deliverable, an AMBIGUOUS surface, an exempt card, or an
 *     unreadable/absent spec is LEFT ALONE — the surface-aware validator never
 *     forces a web url onto those, and FIX-309 remains the hard backstop at
 *     delivery for anything that slips.
 * Best-effort throughout: any read/parse blip is swallowed (a preflight signal
 * must never fail the cycle).
 */
export function runVisualEvidencePreflight(ports: Ports, storyId: string, cycleId: string): void {
  try {
    const specPath = join(cardArchiveDir(ports.repoCwd, storyId), "spec.md");
    if (!existsSync(specPath)) return; // no spec to judge → leave alone (FIX-309 backstops)
    const specText = readFileSync(specPath, "utf8");
    const v = validateStoryVisualEvidence(specText);
    if (v.ok) {
      // Record the pass too (audit: the card was checked and can satisfy the floor).
      ports.events.appendEvent(ports.paths.eventsPath, {
        type: "visual:gate",
        cycleId,
        storyId,
        verdict: "ok",
        surface: v.surface,
        reasons: v.exemptReason !== undefined ? [`exempt: ${v.exemptReason}`] : [],
        ts: eventTs(ports),
      });
      // FIX-339 (AC6) — must-declare STRUCTURAL check (WARN-only this round).
      // Fires ONLY on a card that the surface-aware validator already passed
      // (`ok`) yet declares NONE of {deliverable_url, deliverable_cmd,
      // screenshot_exempt} — i.e. a previously-SILENT card (a terminal/ambiguous
      // visual AC with no concrete capturable surface) that will honest-skip
      // forever and the future hard闸 will catch. It is a SUPPLEMENTARY signal,
      // never a duplicate of an existing validate flag, and NEVER blocks the
      // cycle (the structural hard闸 is held for a separate round post-backfill).
      // FIX-339 (复核 #5) — declaresAnySurface is PURE (specText only): it sees a
      // per-card `screenshot_exempt:` but NOT the policy epic deny-list
      // (acceptance.screenshot_exempt_epics). A card whose EPIC is recorded as
      // non-visual is legitimately exempt and declares no surface ON PURPOSE —
      // flagging it no-surface-declared误杀 a back-end card (owner red line). So
      // treat an epic-exempt card as already declaring a (null) surface here.
      const epicExempt = screenshotExemption(ports.repoCwd, storyId).reason !== undefined;
      if (!epicExempt && !declaresAnySurface(specText)) {
        ports.events.appendEvent(ports.paths.eventsPath, {
          type: "visual:gate",
          cycleId,
          storyId,
          verdict: "flagged",
          code: "no-surface-declared",
          surface: v.surface,
          reasons: ["spec declares no deliverable_url, deliverable_cmd, or screenshot_exempt — no surface to capture"],
          ts: eventTs(ports),
        });
        ports.events.appendAlert(
          ports.paths.alertsPath,
          `[WARN] visual-evidence preflight (${storyId}): no-surface-declared — the spec declares none of ` +
            `\`deliverable_url:\` / \`deliverable_cmd:\` / \`screenshot_exempt: <reason>\` — cycle ${cycleId}. ` +
            `Declare a deliverable surface (web url or CLI command) or a recorded exemption. ` +
            `NOT blocked this round — structural闸 will harden after backfill; FIX-309 still enforces declared surfaces at delivery.`,
        );
      }
      return;
    }
    // CONFIDENT problem → fail loud (ALERT + event), but DO NOT block the cycle.
    const reason = v.reason ?? "visual-evidence contract not satisfied";
    ports.events.appendEvent(ports.paths.eventsPath, {
      type: "visual:gate",
      cycleId,
      storyId,
      verdict: "flagged",
      ...(v.code !== undefined ? { code: v.code } : {}),
      surface: v.surface,
      reasons: [reason],
      ts: eventTs(ports),
    });
    ports.events.appendAlert(
      ports.paths.alertsPath,
      `[WARN] visual-evidence preflight (${storyId}): ${v.code ?? "flagged"} — ${reason} — cycle ${cycleId}. ` +
        `Add a visual-evidence AC` +
        (v.code === "web-surface-without-deliverable-url"
          ? ` AND declare \`deliverable_url:\` (alias \`screenshot_url:\`) for the web surface`
          : ` or a recorded \`screenshot_exempt: <reason>\``) +
        `. NOT blocked — FIX-309 enforces at delivery; this is the cheap early warning.`,
    );
  } catch {
    /* best-effort: a spec read/parse blip must never fail the cycle */
  }
}

/** Compose the gh pr-create body (commit-count-style; kept simple + pure). */
function publishBody(ctx: CycleContext): string {
  return `loop cycle ${ctx.cycleId}${ctx.storyId !== undefined ? ` — ${ctx.storyId}` : ""}`;
}

function rollMetaShaReachableOnOrigin(rollDir: string, sha: string): boolean {
  try {
    const out = execFileSync("git", ["-C", rollDir, "ls-remote", "origin"], { encoding: "utf8" });
    return out.split(/\r?\n/).some((line) => line.startsWith(`${sha}\t`));
  } catch {
    return false;
  }
}

export async function publishBodyWithEvidenceTrailer(ports: Ports, ctx: CycleContext): Promise<string | null> {
  const base = publishBody(ctx);
  const storyId = ctx.storyId ?? "";
  if (storyId === "") return base;
  const message = `chore: loop cycle ${ctx.cycleId}${storyId !== "" ? ` ${storyId}` : ""} evidence`;
  try {
    const committed = await ports.metadata.commit(ports.repoCwd, message);
    if (!committed.nothingToCommit && !committed.pushed) {
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `.roll evidence push FAILED before publish for cycle ${ctx.cycleId}${committed.committed ? " (committed locally, not pushed)" : ""} — ${committed.error ?? "unknown error"}`,
      );
      return null;
    }
    const rollDir = join(ports.repoCwd, ".roll");
    if (!existsSync(rollDir)) {
      ports.events.appendAlert(ports.paths.alertsPath, `Roll-Evidence publish blocked for ${storyId}: .roll git repo missing`);
      return null;
    }
    const rollReal = realpathSync(rollDir);
    const sha = execFileSync("git", ["-C", rollReal, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const map = relative(rollReal, acMapPath(ports.repoCwd, storyId));
    if (sha === "" || map === "" || map.startsWith("..")) {
      ports.events.appendAlert(ports.paths.alertsPath, `Roll-Evidence publish blocked for ${storyId}: ac-map path is not inside roll-meta`);
      return null;
    }
    if (!rollMetaShaReachableOnOrigin(rollReal, sha)) {
      ports.events.appendAlert(ports.paths.alertsPath, `Roll-Evidence publish blocked for ${storyId}: roll-meta sha ${sha} is not reachable from origin`);
      return null;
    }
    return `${base}\n\nRoll-Evidence: ${storyId} roll-meta@${sha} ${map}`;
  } catch (e) {
    ports.events.appendAlert(ports.paths.alertsPath, `.roll evidence trailer failed for cycle ${ctx.cycleId} — ${String(e)}`);
    return null;
  }
}

export function storyRequiresManualMerge(repoCwd: string, storyId: string | undefined): boolean {
  if (storyId === undefined || storyId.trim() === "") return false;
  const needles = ["manual_merge", "manual-merge", "[roll:manual-merge]", "autofix"];
  const containsMarker = (text: string): boolean => {
    const lower = text.toLowerCase();
    return needles.some((n) => lower.includes(n));
  };
  try {
    const backlog = readFileSync(join(repoCwd, ".roll", "backlog.md"), "utf8");
    const row = parseBacklog(backlog).find((it) => it.id === storyId);
    if (row !== undefined && containsMarker(row.desc)) return true;
  } catch {
    /* absent backlog */
  }
  try {
    return containsMarker(readFileSync(join(cardArchiveDir(repoCwd, storyId), "spec.md"), "utf8"));
  } catch {
    return false;
  }
}
