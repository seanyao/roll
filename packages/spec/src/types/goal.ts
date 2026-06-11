export const GOAL_SCHEMA_VERSION = "goal.v1" as const;
export const GOAL_STATUSES = ["active", "paused", "budget_limited", "complete"] as const;
export const GOAL_REVIEW_MODES = ["auto", "hetero", "self", "off"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type GoalReviewMode = (typeof GOAL_REVIEW_MODES)[number];
export type GoalScope = { kind: "all" } | { kind: "epic"; epic: string } | { kind: "cards"; cards: string[] };
export type GoalTransitionActor = "owner" | "system" | "adjudicator" | "worker" | "agent";

export interface GoalLimits {
  maxCycles?: number;
  maxHours?: number;
}

export interface GoalUsage {
  cycles: number;
  costUsd: number;
}

export interface GoalReviewConfig {
  mode: GoalReviewMode;
}

export interface RollGoal {
  schema: typeof GOAL_SCHEMA_VERSION;
  scope: GoalScope;
  review: GoalReviewConfig;
  budgetUsd?: number;
  limits: GoalLimits;
  status: GoalStatus;
  usage: GoalUsage;
  createdAt: string;
  updatedAt: string;
  lastDecisionReason?: string;
}

export interface GoalTransitionContext {
  actor: GoalTransitionActor;
  reason: string;
  at: string;
}

interface Line {
  indent: number;
  key: string;
  value: string;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const noComment = raw.replace(/\s+#.*$/, "");
    if (noComment.trim() === "") continue;
    const m = /^(\s*)([^:]+):(.*)$/.exec(noComment);
    if (m === null) continue;
    out.push({ indent: m[1]!.length, key: m[2]!.trim(), value: m[3]!.trim() });
  }
  return out;
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readTop(all: readonly Line[], key: string): string | undefined {
  return all.find((line) => line.indent === 0 && line.key === key)?.value;
}

function readNested(all: readonly Line[], parent: string, child: string): string | undefined {
  const start = all.findIndex((line) => line.indent === 0 && line.key === parent);
  if (start < 0) return undefined;
  for (let i = start + 1; i < all.length; i += 1) {
    const line = all[i]!;
    if (line.indent === 0) break;
    if (line.indent === 2 && line.key === child) return line.value;
  }
  return undefined;
}

function required(value: string | undefined, key: string): string {
  const cleaned = cleanScalar(value ?? "");
  if (cleaned === "") throw new Error(`goal.yaml invalid: missing ${key}`);
  return cleaned;
}

function optionalNumber(value: string | undefined, key: string): number | undefined {
  const cleaned = cleanScalar(value ?? "");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) throw new Error(`goal.yaml invalid: ${key} must be a non-negative number`);
  return n;
}

function requiredNumber(value: string | undefined, key: string): number {
  const n = optionalNumber(value, key);
  if (n === undefined) throw new Error(`goal.yaml invalid: missing ${key}`);
  return n;
}

function parseList(value: string): string[] {
  const cleaned = cleanScalar(value);
  if (!cleaned.startsWith("[") || !cleaned.endsWith("]")) throw new Error("goal.yaml invalid: scope.cards must be a flow list");
  const inner = cleaned.slice(1, -1).trim();
  if (inner === "") return [];
  return inner.split(",").map((s) => cleanScalar(s.trim())).filter((s) => s !== "");
}

function parseStatus(value: string | undefined): GoalStatus {
  const status = required(value, "status");
  if (!GOAL_STATUSES.includes(status as GoalStatus)) throw new Error(`goal.yaml invalid: status '${status}' is not one of ${GOAL_STATUSES.join(", ")}`);
  return status as GoalStatus;
}

function parseReviewMode(value: string | undefined): GoalReviewMode {
  const mode = cleanScalar(value ?? "auto");
  if (!GOAL_REVIEW_MODES.includes(mode as GoalReviewMode)) throw new Error(`goal.yaml invalid: review '${mode}' is not one of ${GOAL_REVIEW_MODES.join(", ")}`);
  return mode as GoalReviewMode;
}

function parseScope(all: readonly Line[]): GoalScope {
  const kind = required(readNested(all, "scope", "kind"), "scope.kind");
  if (kind === "all") return { kind: "all" };
  if (kind === "epic") return { kind: "epic", epic: required(readNested(all, "scope", "epic"), "scope.epic") };
  if (kind === "cards") {
    const cards = parseList(required(readNested(all, "scope", "cards"), "scope.cards"));
    if (cards.length === 0) throw new Error("goal.yaml invalid: scope.cards must not be empty");
    return { kind: "cards", cards };
  }
  throw new Error(`goal.yaml invalid: scope.kind '${kind}' is not one of all, epic, cards`);
}

export function parseGoalYaml(text: string): RollGoal {
  const all = lines(text);
  const schema = required(readTop(all, "schema"), "schema");
  if (schema !== GOAL_SCHEMA_VERSION) throw new Error(`goal.yaml invalid: schema must be ${GOAL_SCHEMA_VERSION}`);
  const budgetUsd = optionalNumber(readTop(all, "budgetUsd"), "budgetUsd");
  const maxCycles = optionalNumber(readNested(all, "limits", "maxCycles"), "limits.maxCycles");
  const maxHours = optionalNumber(readNested(all, "limits", "maxHours"), "limits.maxHours");
  const lastDecisionReason = cleanScalar(readTop(all, "lastDecisionReason") ?? "");
  return {
    schema: GOAL_SCHEMA_VERSION,
    scope: parseScope(all),
    review: { mode: parseReviewMode(readTop(all, "review")) },
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    limits: {
      ...(maxCycles !== undefined ? { maxCycles } : {}),
      ...(maxHours !== undefined ? { maxHours } : {}),
    },
    status: parseStatus(readTop(all, "status")),
    usage: {
      cycles: requiredNumber(readNested(all, "usage", "cycles"), "usage.cycles"),
      costUsd: requiredNumber(readNested(all, "usage", "costUsd"), "usage.costUsd"),
    },
    createdAt: required(readTop(all, "createdAt"), "createdAt"),
    updatedAt: required(readTop(all, "updatedAt"), "updatedAt"),
    ...(lastDecisionReason !== "" ? { lastDecisionReason } : {}),
  };
}

function renderScope(scope: GoalScope): string[] {
  if (scope.kind === "all") return ["scope:", "  kind: all"];
  if (scope.kind === "epic") return ["scope:", "  kind: epic", `  epic: ${scope.epic}`];
  return ["scope:", "  kind: cards", `  cards: [${scope.cards.join(", ")}]`];
}

export function renderGoalYaml(goal: RollGoal): string {
  const out = [
    `schema: ${goal.schema}`,
    ...renderScope(goal.scope),
    `review: ${goal.review.mode}`,
    ...(goal.budgetUsd !== undefined ? [`budgetUsd: ${goal.budgetUsd}`] : []),
    "limits:",
    ...(goal.limits.maxCycles !== undefined ? [`  maxCycles: ${goal.limits.maxCycles}`] : []),
    ...(goal.limits.maxHours !== undefined ? [`  maxHours: ${goal.limits.maxHours}`] : []),
    `status: ${goal.status}`,
    "usage:",
    `  cycles: ${goal.usage.cycles}`,
    `  costUsd: ${goal.usage.costUsd}`,
    `createdAt: ${goal.createdAt}`,
    `updatedAt: ${goal.updatedAt}`,
    ...(goal.lastDecisionReason !== undefined ? [`lastDecisionReason: ${goal.lastDecisionReason}`] : []),
  ];
  return `${out.join("\n")}\n`;
}

const TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  active: ["paused", "budget_limited", "complete"],
  paused: ["active", "complete"],
  budget_limited: ["active", "paused", "complete"],
  complete: [],
};

export function transitionGoal(goal: RollGoal, next: GoalStatus, ctx: GoalTransitionContext): RollGoal {
  if (goal.status === "complete") throw new Error("goal state machine: complete is terminal");
  if (!TRANSITIONS[goal.status].includes(next)) throw new Error(`goal state machine: illegal ${goal.status} -> ${next}`);
  if (next === "complete" && ctx.actor !== "adjudicator") throw new Error("goal state machine: only adjudicator may complete a goal");
  return { ...goal, status: next, updatedAt: ctx.at, lastDecisionReason: ctx.reason };
}
