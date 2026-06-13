/**
 * US-DOSSIER-030 — the Loop-tab CASTING collector: "who plays which role".
 *
 * The design reference (`Delivery Dossier.dc.html` lines 224–239 / `CASTING`
 * data 929–938) shows a Role | Agent | Note grid with two row families:
 *   - four COMPLEXITY slots — Executor · easy / default / hard / fallback —
 *     resolved from the router slot config (`agents.yaml`, read via the same
 *     `readSlot(tier|"fallback")` port `packages/core/src/agent/router.ts`
 *     consumes). An empty/unconfigured slot renders an explicit em-dash, never
 *     a guessed agent.
 *   - four SCENARIO roles — peer re-check, PR review, adversarial spar, onboard
 *     — the "who plays what" view the loop dispatches across. The peer row
 *     carries the heterogeneity rule (auto-picked, MUST differ from the
 *     builder); the spar row shows the adversarial pair; onboard follows the
 *     active interactive client.
 *
 * Purity (mirrors router Invariant I10): this collector NEVER reads the
 * filesystem / PATH / clock. Slot reads, the spar pair, the active onboard
 * client, and the route-resolve audit trail are all INJECTED via {@link
 * CastingDeps}. Same inputs → same Casting view-model. The default deps
 * (`defaultCastingDeps`) do the best-effort `.roll/` reads at the call site.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSlotFromText, type AgentSlot } from "@roll/core";

/** One row of the Casting grid (Role | Agent | Note). */
export interface CastingRow {
  /** Stable machine key (slot tier name or scenario id) — drives test asserts. */
  key: "easy" | "default" | "hard" | "fallback" | "peer" | "review-pr" | "spar" | "onboard";
  roleEn: string;
  roleZh: string;
  /** Resolved agent / pair / rule text. `mono:true` ⇒ a literal agent token. */
  agentEn: string;
  agentZh: string;
  /** A bare agent token (rendered monospace) vs a prose rule (rendered prose). */
  mono: boolean;
  /** `true` when this row resolved to nothing configured (renders the em-dash). */
  empty: boolean;
  noteEn: string;
  noteZh: string;
  /** A route-resolve / nudge rationale to surface, when an audit trail exists;
   *  empty string ⇒ "config only", nothing marked inferred. */
  audit: string;
}

/** The Casting view-model (the four complexity slots, then the four scenarios). */
export interface CastingVM {
  rows: CastingRow[];
  /** A casting was resolvable at all (any slot configured OR a scenario known). */
  configured: boolean;
}

/** Ports injected into {@link collectCasting}; keep the collector pure. */
export interface CastingDeps {
  /** Read a router slot's agent (`undefined` when empty/unconfigured) — the SAME
   *  port `resolveRoute` consumes (`agents.yaml`). */
  readSlot: (slot: AgentSlot) => string | undefined;
  /** The heterogeneous adversarial spar pair `[a, b]`, when pairing is configured
   *  and both candidates are known; `undefined` ⇒ unconfigured (em-dash). */
  sparPair?: () => [string, string] | undefined;
  /** The active interactive client the onboard role follows (`undefined` ⇒ none
   *  active, the row states it follows whatever client is interactive). */
  onboardClient?: () => string | undefined;
  /** A route-resolve / nudge rationale for a slot, when an audit trail exists in
   *  `.roll/loop/events.ndjson`; `undefined` ⇒ no audit, render config plainly. */
  routeAudit?: (slot: AgentSlot) => string | undefined;
}

const EM_DASH = "—";

/** Build one complexity-slot row honestly: configured agent or em-dash. */
function slotRow(
  key: "easy" | "default" | "hard" | "fallback",
  roleEn: string,
  roleZh: string,
  deps: CastingDeps,
): CastingRow {
  const agent = deps.readSlot(key);
  const empty = agent === undefined || agent === "";
  const audit = deps.routeAudit?.(key) ?? "";
  return {
    key,
    roleEn,
    roleZh,
    agentEn: empty ? EM_DASH : agent,
    agentZh: empty ? EM_DASH : agent,
    mono: !empty,
    empty,
    noteEn: empty ? "slot empty" : "slot",
    noteZh: empty ? "槽位未配" : "槽位",
    audit,
  };
}

/**
 * Resolve the Casting view-model from injected ports — pure, deterministic.
 *
 * Row order matches the design reference exactly:
 *   Executor · easy / default / hard / fallback, then peer / review-pr / spar /
 *   onboard. The peer row never resolves to a concrete agent (it is auto-picked
 *   per cycle and MUST differ from the builder); the review-pr row reuses the
 *   `default` slot agent (the loop dispatches PR review to it) and falls back to
 *   an em-dash when unconfigured; the spar row shows the heterogeneous pair when
 *   known; the onboard row follows the active interactive client.
 */
export function collectCasting(deps: CastingDeps): CastingVM {
  const rows: CastingRow[] = [
    slotRow("easy", "Executor · easy", "执行 · easy", deps),
    slotRow("default", "Executor · default", "执行 · default", deps),
    slotRow("hard", "Executor · hard", "执行 · hard", deps),
    slotRow("fallback", "Executor · fallback", "执行 · fallback", deps),
  ];

  // peer re-check — never a fixed agent; the heterogeneity rule IS the truth.
  rows.push({
    key: "peer",
    roleEn: "Peer re-check",
    roleZh: "同伴复核 peer",
    agentEn: "auto-picked — must differ from builder",
    agentZh: "自动挑选——强制异构于执行者",
    mono: false,
    empty: false,
    noteEn: "pairing rule",
    noteZh: "结对规则",
    audit: "",
  });

  // PR review — the loop dispatches review-pr to the `default` slot agent.
  const prAgent = deps.readSlot("default");
  const prEmpty = prAgent === undefined || prAgent === "";
  rows.push({
    key: "review-pr",
    roleEn: "PR review",
    roleZh: "PR 评审",
    agentEn: prEmpty ? EM_DASH : prAgent,
    agentZh: prEmpty ? EM_DASH : prAgent,
    mono: !prEmpty,
    empty: prEmpty,
    noteEn: "review-pr",
    noteZh: "review-pr",
    audit: "",
  });

  // adversarial spar — the heterogeneous attacker ⚔ defender pair.
  const pair = deps.sparPair?.();
  const sparEmpty = pair === undefined;
  rows.push({
    key: "spar",
    roleEn: "Adversarial TDD",
    roleZh: "攻防 spar",
    agentEn: sparEmpty ? EM_DASH : `${pair[0]} ⚔ ${pair[1]}`,
    agentZh: sparEmpty ? EM_DASH : `${pair[0]} ⚔ ${pair[1]}`,
    mono: !sparEmpty,
    empty: sparEmpty,
    noteEn: "pair",
    noteZh: "对抗对",
    audit: "",
  });

  // onboard — follows whatever client is interactive right now.
  const client = deps.onboardClient?.();
  rows.push({
    key: "onboard",
    roleEn: "Onboard",
    roleZh: "接入 onboard",
    agentEn: client !== undefined && client !== "" ? client : "follows the active client",
    agentZh: client !== undefined && client !== "" ? client : "跟随当前交互客户端",
    mono: client !== undefined && client !== "",
    empty: false,
    noteEn: "interactive",
    noteZh: "交互式",
    audit: "",
  });

  const configured = rows.some((r) => !r.empty && (r.key === "easy" || r.key === "default" || r.key === "hard" || r.key === "fallback"));
  return { rows, configured };
}

const SLOTS: readonly AgentSlot[] = ["easy", "default", "hard", "fallback"];

/**
 * Best-effort real-`.roll/` deps for {@link collectCasting}. All reads are guarded
 * (a missing/unreadable file degrades to an unconfigured slot — never a throw,
 * never a guessed agent). Mirrors the no-guess discipline of `loop-heartbeat`'s
 * default deps.
 *
 *   - readSlot   ← `.roll/agents.yaml` (the router's slot config), via the SAME
 *     pure `readSlotFromText` `core/agent/registry` exports.
 *   - routeAudit ← `.roll/loop/events.ndjson` `route:resolve` rows (latest wins),
 *     surfacing the recorded rationale only where one was actually logged.
 *   - sparPair / onboardClient stay undefined here (no second launchd/PATH probe);
 *     the row renders honestly (the heterogeneity rule, the active-client note).
 */
export function defaultCastingDeps(projectPath: string): CastingDeps {
  let agentsText: string | null = null;
  const agentsPath = process.env["ROLL_AGENTS_CONFIG"] ?? join(projectPath, ".roll", "agents.yaml");
  try {
    if (existsSync(agentsPath)) agentsText = readFileSync(agentsPath, "utf8");
  } catch {
    agentsText = null;
  }

  // route:resolve audit: scan events.ndjson once, keep the LATEST rationale per
  // slot tier. The line shape is the loop's auditable event — we read it as a
  // generic record so a schema add never crashes the dossier render.
  const auditBySlot = new Map<string, string>();
  try {
    const evPath = join(projectPath, ".roll", "loop", "events.ndjson");
    if (existsSync(evPath)) {
      const content = readFileSync(evPath, "utf8");
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (t === "" || !t.includes("route:resolve")) continue;
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(t) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (row["type"] !== "route:resolve") continue;
        const tier = typeof row["tier"] === "string" ? (row["tier"] as string) : "";
        const rationale = typeof row["rationale"] === "string" ? (row["rationale"] as string) : "";
        if (tier !== "" && rationale !== "") auditBySlot.set(tier, rationale);
      }
    }
  } catch {
    /* no audit trail — rows render config plainly, nothing marked inferred */
  }

  return {
    readSlot: (slot) => {
      if (agentsText === null) return undefined;
      if (!SLOTS.includes(slot)) return undefined;
      return readSlotFromText(agentsText, slot);
    },
    routeAudit: (slot) => auditBySlot.get(slot),
  };
}
