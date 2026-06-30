/**
 * Command-surface truth source — REFACTOR-056.
 *
 * A single typed registry of every command decision: public, nested, internal,
 * or removed. `roll --help`, README, docs, and release consistency checks all
 * read from this source so the surface never drifts.
 *
 * REFACTOR-056 scope: establish the registry and wire `roll --help` to project
 * only the public top-level list. No command behavior is moved here.
 */

// ── Types ───────────────────────────────────────────────────────────────

/** Who should see this command. */
export type CommandAudience = "human" | "internal" | "hidden";

/**
 * What happens to this entry point:
 *  - `public`  → visible in `roll --help`, README, guide, site
 *  - `nested`  → reachable through an owning command (e.g. `config prices`)
 *  - `internal` → callable by machine (scheduler/CI/loop workers), hidden from public
 *  - `remove`  → no longer callable; returns unknown-command
 */
export type CommandDisposition = "public" | "nested" | "internal" | "remove";

/** The owning command a capability belongs under. */
export type OwnerCommand =
  | "agent"
  | "backlog"
  | "config"
  | "design"
  | "doctor"
  | "help"
  | "idea"
  | "init"
  | "loop"
  | "next"
  | "release"
  | "setup"
  | "status"
  | "test"
  | "update";

/** One recorded decision for one command entry point. */
export interface CommandSurfaceDecision {
  /** Current top-level registration name. */
  readonly current: string;
  /** Target name when moved under a parent (e.g. "config prices"). */
  readonly target?: string;
  /** Owning command. */
  readonly owner: OwnerCommand;
  /** Who should see this command. */
  readonly audience: CommandAudience;
  /** What happens to this entry point. */
  readonly disposition: CommandDisposition;
  /** Why this decision was made. */
  readonly rationale: string;
}

// ── Canonical registry ─────────────────────────────────────────────────

/**
 * Every top-level command registration MUST appear here.
 *
 * Order: public top-level first (the order `roll --help` uses),
 * then nested, then internal, then removed.
 */
export const COMMAND_SURFACE: readonly CommandSurfaceDecision[] = [
  // ── Public top-level (shown in `roll --help`) ──────────────────────────
  {
    current: "agent",
    owner: "agent",
    audience: "human",
    disposition: "public",
    rationale: "Agent scope management — daily owner workflow.",
  },
  {
    current: "backlog",
    owner: "backlog",
    audience: "human",
    disposition: "public",
    rationale: "Backlog board — the project's work tracker.",
  },
  {
    current: "config",
    owner: "config",
    audience: "human",
    disposition: "public",
    rationale: "Configuration read/write surface.",
  },
  {
    current: "design",
    owner: "design",
    audience: "human",
    disposition: "public",
    rationale: "Design entry point for $roll-design skill.",
  },
  {
    current: "doctor",
    owner: "doctor",
    audience: "human",
    disposition: "public",
    rationale: "Environment + install diagnosis surface.",
  },
  {
    current: "help",
    owner: "help",
    audience: "human",
    disposition: "public",
    rationale: "Built-in help/Charter/guide viewer.",
  },
  {
    current: "idea",
    owner: "idea",
    audience: "human",
    disposition: "public",
    rationale: "Quick idea/bug capture into backlog.",
  },
  {
    current: "init",
    owner: "init",
    audience: "human",
    disposition: "public",
    rationale: "Project initialization and repair.",
  },
  {
    current: "loop",
    owner: "loop",
    audience: "human",
    disposition: "public",
    rationale: "Loop lifecycle and observation.",
  },
  {
    current: "next",
    owner: "next",
    audience: "human",
    disposition: "public",
    rationale: "What to work on next — owner-facing triage.",
  },
  {
    current: "release",
    owner: "release",
    audience: "human",
    disposition: "public",
    rationale: "Release guidance and consistency checks.",
  },
  {
    current: "setup",
    owner: "setup",
    audience: "human",
    disposition: "public",
    rationale: "Conventions and template installation.",
  },
  {
    current: "status",
    owner: "status",
    audience: "human",
    disposition: "public",
    rationale: "Project health snapshot.",
  },
  {
    current: "test",
    owner: "test",
    audience: "human",
    disposition: "public",
    rationale: "Test runner.",
  },
  {
    current: "update",
    owner: "update",
    audience: "human",
    disposition: "public",
    rationale: "Upgrade roll to the latest release.",
  },

  // ── Nested (reachable under a parent command) ──────────────────────────
  {
    current: "doc",
    owner: "help",
    audience: "human",
    disposition: "nested",
    rationale: "Documentation viewing should live under help.",
  },
  {
    current: "prices",
    owner: "config",
    audience: "human",
    disposition: "nested",
    rationale: "Model prices are cost-accounting config data.",
  },
  {
    current: "tune",
    owner: "config",
    audience: "human",
    disposition: "nested",
    rationale: "Self-tuning config advice.",
  },
  {
    current: "cast",
    owner: "agent",
    audience: "human",
    disposition: "nested",
    rationale: "Role casting view belongs to agent scope.",
  },
  {
    current: "tool",
    owner: "doctor",
    audience: "human",
    disposition: "nested",
    rationale: "Tool readiness is a diagnosis surface.",
  },
  {
    current: "pulse",
    owner: "status",
    audience: "human",
    disposition: "nested",
    rationale: "Pulse is a status projection.",
  },
  {
    current: "ci",
    owner: "status",
    audience: "human",
    disposition: "nested",
    rationale: "CI state is a status projection.",
  },
  {
    current: "cycles",
    owner: "loop",
    audience: "human",
    disposition: "nested",
    rationale: "Cycle ledger belongs to the loop domain.",
  },
  {
    current: "cycle",
    owner: "loop",
    audience: "human",
    disposition: "nested",
    rationale: "Cycle trace belongs to the loop domain.",
  },
  {
    current: "showcase",
    owner: "release",
    audience: "human",
    disposition: "nested",
    rationale: "Golden-path E2E is release validation.",
  },
  {
    current: "offboard",
    owner: "setup",
    audience: "human",
    disposition: "nested",
    rationale: "Offboarding is reverse setup lifecycle.",
  },

  // ── Internal / machine-only ──────────────────────────────────────────
  {
    current: "alert",
    owner: "loop",
    audience: "internal",
    disposition: "nested",
    rationale: "Alert surface reached via loop alert, not standalone.",
  },
  {
    current: "attest",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Acceptance evidence report — internal gate.",
  },
  {
    current: "truth",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Delivery truth query — internal reconciliation gate.",
  },
  {
    current: "story",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Card-folder minting and validation — agent bridge.",
  },
  {
    current: "index",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Backlog→epic map regeneration — auto-runs per cycle.",
  },
  {
    current: "gc",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Attest-run garbage collection — auto-runs per cycle.",
  },
  {
    current: "dream",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Nightly architecture scan — scheduled, not owner-facing.",
  },
  {
    current: "skills",
    owner: "doctor",
    audience: "internal",
    disposition: "internal",
    rationale: "Skill audit/sync — reached through doctor/setup.",
  },
  {
    current: "ls",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Cross-project registry listing — internal tool.",
  },
  {
    current: "pair",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Cross-agent pairing — loop/evaluator internal.",
  },
  {
    current: "peer",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Peer review adapter — loop/evaluator internal.",
  },
  {
    current: "supervisor",
    owner: "loop",
    audience: "internal",
    disposition: "internal",
    rationale: "Prime Agent — loop observation surface.",
  },
  {
    current: "version",
    owner: "update",
    audience: "hidden",
    disposition: "internal",
    rationale: "Alias for --version / -v. Keep callable; hidden from usage.",
  },

  // ── Remove (no longer callable) ───────────────────────────────────────
  {
    current: "pair init",
    owner: "loop",
    audience: "hidden",
    disposition: "remove",
    rationale: "Legacy pairing init scaffold — retired.",
  },
];

// ── Derived accessors ──────────────────────────────────────────────────

/** Public top-level commands shown in `roll --help`. Ordered. */
export function publicCommands(): string[] {
  return COMMAND_SURFACE.filter((d) => d.disposition === "public").map((d) => d.current);
}

/** Commands nested under an owner but no longer standalone top-level. */
export function nestedCommands(): CommandSurfaceDecision[] {
  return COMMAND_SURFACE.filter((d) => d.disposition === "nested");
}

/** Commands callable only by machine, hidden from public. */
export function internalCommands(): string[] {
  return COMMAND_SURFACE.filter((d) => d.disposition === "internal").map((d) => d.current);
}

/** Commands that must be removed from dispatch entirely. */
export function removedCommands(): string[] {
  return COMMAND_SURFACE.filter((d) => d.disposition === "remove").map((d) => d.current);
}

/** Commands that must not appear in public `roll --help`. */
export function hiddenFromUsage(): string[] {
  return COMMAND_SURFACE.filter((d) => d.disposition !== "public").map((d) => d.current);
}

/**
 * Fail-loud validation: throws if a command has no entry in the registry.
 * Used in tests to catch any ported command that wasn't classified.
 */
export function requireAllClassified(ported: string[]): void {
  const classified = new Set(COMMAND_SURFACE.map((d) => d.current));
  const missing = ported.filter((c) => !classified.has(c) && !c.startsWith("-"));
  if (missing.length > 0) {
    throw new Error(
      `Command-surface registry missing entries for: ${missing.join(", ")}.\n` +
        "Every ported command must be classified in COMMAND_SURFACE.",
    );
  }
}
