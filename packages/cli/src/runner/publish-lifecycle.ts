import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseBacklog, type CycleContext } from "@roll/core";
import { checkImageEvidenceAllowed, imageEvidencePathsInWorkingTree } from "@roll/infra";
import { cardArchiveDir } from "../lib/archive.js";
import { validateStoryVisualEvidence } from "../lib/design-visual-evidence.js";
import { acMapPath } from "./attest-remediation.js";
import { declaresAnySurface, screenshotExemption } from "./attest-gate.js";
import { ingestGateMode, recordIngestHold } from "./ingest-gate.js";
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
 *     regardless. A false positive can therefore NOT topple a CLI/back-end card.
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
      // FIX-339 (AC6) / REFACTOR-076 — must-declare STRUCTURAL check.
      // Fires ONLY on a card that the surface-aware validator already passed
      // (`ok`) yet declares NONE of {deliverable_url, deliverable_cmd,
      // screenshot_exempt} — i.e. a previously-SILENT card (a terminal/ambiguous
      // visual AC with no concrete capturable surface) that will honest-skip
      // forever. It is a SUPPLEMENTARY diagnostic, never a duplicate of an
      // existing validate flag, and NEVER blocks or alerts during runtime.
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
          verdict: "diagnostic",
          code: "no-surface-declared",
          surface: v.surface,
          reasons: ["spec declares no deliverable_url, deliverable_cmd, or screenshot_exempt — no surface to capture"],
          ts: eventTs(ports),
        });
        // US-EVID-022: phased ingest SOFT gate. The diagnostic above is
        // observe-only (metric). In `alert`/`block` mode, also record the card
        // to the ingest hold list and raise a visible alert. Still NON-blocking —
        // control flow returns below regardless (owner red line: a false
        // positive must never stall the loop); `block` means "held for an
        // authoring fix", never "crash ingest".
        const ingestMode = ingestGateMode(ports.repoCwd);
        if (ingestMode === "alert" || ingestMode === "block") {
          recordIngestHold(
            dirname(ports.paths.eventsPath),
            storyId,
            "AC block but no declared capture surface (deliverable_url/cmd/physical) or screenshot_exempt",
            eventTs(ports),
          );
          ports.events.appendAlert(
            ports.paths.alertsPath,
            `[${ingestMode === "block" ? "HOLD" : "WARN"}] ingest gate (${storyId}): AC block declares no ` +
              `capture surface or screenshot_exempt — recorded to ingest-hold for an authoring fix; NOT ` +
              `blocking the cycle — cycle ${cycleId}`,
          );
        }
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

type RollEvidenceLayout = "missing" | "nested" | "in-repo";

function rollEvidenceLayout(repoCwd: string): RollEvidenceLayout {
  const rollDir = join(repoCwd, ".roll");
  if (!existsSync(rollDir)) return "missing";
  try {
    const top = execFileSync("git", ["-C", rollDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (top === "") return "missing";
    return realpathSync(top) === realpathSync(rollDir) ? "nested" : "in-repo";
  } catch {
    return "missing";
  }
}

async function commitInRepoEvidence(ports: Ports, ctx: CycleContext, storyId: string): Promise<boolean> {
  const cardDir = cardArchiveDir(ports.repoCwd, storyId);
  const acMap = acMapPath(ports.repoCwd, storyId);
  const runDir = ctx.cycleId !== "" ? join(cardDir, ctx.cycleId) : "";
  if (!existsSync(acMap)) {
    ports.events.appendAlert(ports.paths.alertsPath, `Roll-Evidence publish blocked for ${storyId}: ac-map.json missing after remediation`);
    return false;
  }
  if (runDir === "" || !existsSync(runDir)) {
    ports.events.appendAlert(ports.paths.alertsPath, `Roll-Evidence publish blocked for ${storyId}: cycle run-dir missing for ${ctx.cycleId}`);
    return false;
  }
  const relAcMap = relative(ports.repoCwd, acMap);
  const relRunDir = relative(ports.repoCwd, runDir);
  if (relAcMap === "" || relRunDir === "" || relAcMap.startsWith("..") || relRunDir.startsWith("..")) {
    ports.events.appendAlert(ports.paths.alertsPath, `Roll-Evidence publish blocked for ${storyId}: evidence path escapes repo`);
    return false;
  }
  // US-PHYSICAL-008: for in-repo .roll layouts, the main repo remote governs
  // visibility. Block image evidence on public/unknown remotes unless waived.
  const imagePaths = imageEvidencePathsInWorkingTree(ports.repoCwd);
  if (imagePaths.length > 0) {
    const check = await checkImageEvidenceAllowed(ports.repoCwd, ports.repoCwd);
    if (!check.allowed) {
      ports.events.appendAlert(
        ports.paths.alertsPath,
        `Roll-Evidence publish blocked for ${storyId}: ${check.reason}`,
      );
      return false;
    }
  }
  try {
    // FIX-1238: target the WORKTREE git (delivery branch), not the main checkout.
    const evidenceCwd = ports.paths?.worktreePath ?? ports.repoCwd;
    // FIX-1238: only use --git-dir targeting when .git is a FILE (worktree)
    // not a directory (bare/main checkout). readFileSync on a dir would throw.
    const worktreeGitFile = join(evidenceCwd, ".git");
    let worktreeGitDir: string | undefined;
    let isWorktreeTarget = false;
    if (ports.paths?.worktreePath !== undefined && existsSync(worktreeGitFile) && lstatSync(worktreeGitFile).isFile()) {
      const gitContent = readFileSync(worktreeGitFile, "utf8").trim();
      const m = gitContent.match(/^gitdir:\s*(.+)$/m);
      if (m && m[1]) {
        const parsedGitDir = m[1].trim();
        worktreeGitDir = resolve(evidenceCwd, parsedGitDir);
        isWorktreeTarget = true;
      }
    }
    const gitTarget = worktreeGitDir !== undefined && isWorktreeTarget
      ? ["--git-dir", worktreeGitDir, "--work-tree", ports.paths.worktreePath]
      : [];
    // FIX-1238: also include backlog.md so the status flip rides the PR branch.
    const backlogPath = join(ports.repoCwd, ".roll", "backlog.md");
    const trackedPaths = [relAcMap, relRunDir];
    if (existsSync(backlogPath)) {
      trackedPaths.push(relative(ports.repoCwd, backlogPath));
    }
    execFileSync("git", [...gitTarget, "add", "-A", "-f", "--", ...trackedPaths], { cwd: ports.repoCwd, stdio: "ignore" });
    const dirty = execFileSync("git", [...gitTarget, "status", "--porcelain", "--", ...trackedPaths], {
      cwd: ports.repoCwd,
      encoding: "utf8",
    }).trim();
    if (dirty === "") return true;
    execFileSync("git", [...gitTarget, "commit", "-m", `chore: attach acceptance evidence for ${storyId}`], {
      cwd: ports.repoCwd,
      stdio: "ignore",
    });
    return true;
  } catch (e) {
    ports.events.appendAlert(ports.paths.alertsPath, `Roll-Evidence publish blocked for ${storyId}: in-repo evidence commit failed — ${String(e)}`);
    return false;
  }
}

export async function publishBodyWithEvidenceTrailer(ports: Ports, ctx: CycleContext): Promise<string | null> {
  const base = publishBody(ctx);
  const storyId = ctx.storyId ?? "";
  if (storyId === "") return base;
  if (rollEvidenceLayout(ports.repoCwd) === "in-repo") {
    return (await commitInRepoEvidence(ports, ctx, storyId)) ? base : null;
  }
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
