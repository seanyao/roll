/**
 * Brief composition (US-PORT-002) — the deterministic owner digest model.
 *
 * The v2 `roll brief` displayed a *cached, agent-authored* `.roll/briefs/*.md`
 * (the roll-brief skill wrote the narrative; the command only rendered it). The
 * v3 port instead COMPOSES the digest live from the structured readers the
 * backlog already exposes — exactly as the backlog row mandates ("用既有 …
 * backlog 读取器合成 owner 简报"). Composing from data rather than shelling an
 * agent is the strongest possible satisfaction of the "agent 绝不漏思考过程" AC:
 * no agent runs, so no reasoning can leak. There is no staleness and no regen
 * dance — every invocation reflects the current backlog truth.
 *
 * This module is pure: backlog rows (+ any active ALERT identifiers) in, a
 * {@link BriefModel} out. Rendering and locale live in the cli adapter.
 */
import { classifyStatus } from "@roll/spec";
import type { BacklogItem } from "../backlog/store.js";

/** The three-block owner digest, pre-bucketed for rendering. */
export interface BriefModel {
  /** ✅ Done rows — what shipped. */
  shipped: BacklogItem[];
  /** 🔨 In Progress rows — actively being worked. */
  inProgress: BacklogItem[];
  /** 📋 Todo rows, FIX-* (bugs lead the queue). */
  queueFix: BacklogItem[];
  /** 📋 Todo rows, US-*. */
  queueUs: BacklogItem[];
  /** 📋 Todo rows, REFACTOR / IDEA (everything else pending). */
  queueOther: BacklogItem[];
  /** 🚫 Hold rows — explicitly parked, awaiting an owner ruling. */
  hold: BacklogItem[];
  /** 🔒 Blocked / ⏸ Deferred rows. */
  blocked: BacklogItem[];
  /** Active ALERT file identifiers (basenames), threaded in by the adapter. */
  alerts: string[];
}

/**
 * Bucket backlog rows by status into the digest model. Status comes from the ONE
 * typed classifier ({@link classifyStatus}, REFACTOR-047) — no ad-hoc substring
 * matching here. Within the `hold` state the digest keeps a display-only split:
 * the canonical 🚫 Hold (awaiting an owner ruling) vs the legacy 🔒 Blocked /
 * ⏸ Deferred triage markers; functionally both count toward {@link decideCount}.
 */
export function composeBrief(items: BacklogItem[], alerts: string[]): BriefModel {
  const m: BriefModel = {
    shipped: [],
    inProgress: [],
    queueFix: [],
    queueUs: [],
    queueOther: [],
    hold: [],
    blocked: [],
    alerts: [...alerts],
  };
  for (const it of items) {
    switch (classifyStatus(it.status)) {
      case "done":
        m.shipped.push(it);
        break;
      case "in_progress":
        m.inProgress.push(it);
        break;
      case "hold":
        // Display-only refinement: canonical 🚫 Hold vs legacy 🔒 Blocked / ⏸ Deferred.
        if (it.status.includes("Hold")) m.hold.push(it);
        else m.blocked.push(it);
        break;
      case "todo":
        if (it.id.startsWith("FIX-")) m.queueFix.push(it);
        else if (it.id.startsWith("US-")) m.queueUs.push(it);
        else m.queueOther.push(it);
        break;
    }
  }
  return m;
}

/** Total pending (📋 Todo) rows across every queue bucket. */
export function queueTotal(m: BriefModel): number {
  return m.queueFix.length + m.queueUs.length + m.queueOther.length;
}

/** How many items genuinely need the owner's call: alerts + holds + blocks. */
export function decideCount(m: BriefModel): number {
  return m.alerts.length + m.hold.length + m.blocked.length;
}

/** Release-ready iff nothing is waiting on the owner. */
export function releaseReady(m: BriefModel): boolean {
  return decideCount(m) === 0;
}
