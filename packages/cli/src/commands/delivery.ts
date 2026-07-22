import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  deriveIssueCompletion,
  validateStoryId,
} from "@roll/core";
import {
  IssueCompletionEvidenceError,
  readIssueCompletionEvidence,
} from "@roll/infra";
import {
  integrationAcceptanceCommandDigest,
  parseIssueManifest,
  resolveLang,
  t,
  v3Catalog,
  type IssueCompletionProjection,
  type IssueIntegrationAcceptanceEvidence,
  type IssueManifest,
  type RepositoryMergeEvidence,
} from "@roll/spec";
import { configLang } from "./lang.js";
import {
  resolveBacklogCommandTarget,
  type BacklogAggregateEntry,
  type BacklogOperation,
  type BacklogTargetDecision,
  type BacklogTargetResolver,
  type ResolvedBacklogTarget,
} from "./backlog-target.js";

const DELIVERY_LIST_V1 = "roll.delivery-list/v1" as const;
const DELIVERY_VIEW_V1 = "roll.delivery-view/v1" as const;
const DELIVERY_RECONCILE_V1 = "roll.delivery-reconcile/v1" as const;
const DELIVERY_ERROR_V1 = "roll.delivery-error/v1" as const;

type DeliveryAcceptanceStatus = "missing" | "pass" | "failed" | "input_mismatch";

type DeliveryRepositoryFact =
  | {
      readonly authority: "provider";
      readonly cycleId: string;
      readonly recordedAt: number;
      readonly prNumber?: number;
      readonly prState: "OPEN" | "MERGED" | "CLOSED" | "UNKNOWN";
      readonly ci: "green" | "red" | "pending" | "unknown";
      readonly mergeCommit?: string;
      readonly mergedAt?: number;
    }
  | {
      readonly authority: "integration_branch";
      readonly cycleId: string;
      readonly recordedAt: number;
      readonly reachable: boolean;
      readonly mergeCommit?: string;
    }
  | {
      readonly authority: "projection";
      readonly cycleId: string;
      readonly recordedAt: number;
      readonly state: "building" | "awaiting_merge" | "merged" | "blocked" | "abandoned";
      readonly mergeCommit?: string;
    };

export type DeliveryOutstandingGate =
  | {
      readonly kind: "repository";
      readonly repoId: string;
      readonly status: "none" | "building" | "awaiting_merge" | "blocked" | "abandoned";
    }
  | {
      readonly kind: "integration_acceptance";
      readonly status: Exclude<DeliveryAcceptanceStatus, "pass">;
    }
  | {
      readonly kind: "conflict";
      readonly repoId: string;
      readonly code: "conflicting_merge_commit" | "strong_fact_conflict" | "invalid_merge_evidence";
    };

export interface DeliveryRepositoryView {
  readonly repoId: string;
  readonly alias: string;
  readonly access: "write";
  readonly requiredDelivery: true;
  readonly status: IssueCompletionProjection["repositories"][number]["status"];
  readonly authority?: IssueCompletionProjection["repositories"][number]["authority"];
  readonly mergeCommit?: string;
  readonly facts: readonly DeliveryRepositoryFact[];
}

export interface DeliveryAcceptanceView {
  readonly status: DeliveryAcceptanceStatus;
  readonly expectedCommandDigest?: string;
  readonly inputMergeCommits?: Readonly<Record<string, string>>;
  readonly commandDigest?: string;
  readonly profile?: string;
  readonly verdict?: "pass" | "fail";
  readonly artifactPath?: string;
  readonly recordedAt?: number;
}

export interface DeliveryIssueView {
  readonly workspaceId: string;
  readonly storyId: string;
  readonly state: IssueCompletionProjection["state"];
  readonly repositories: readonly DeliveryRepositoryView[];
  readonly mergeCommits: Readonly<Record<string, string>>;
  readonly integrationAcceptance: DeliveryAcceptanceView;
  readonly conflicts: IssueCompletionProjection["conflicts"];
  readonly outstandingGates: readonly DeliveryOutstandingGate[];
}

export interface DeliveryWorkspaceView {
  readonly workspaceId: string;
  readonly path: string;
  readonly issues: readonly DeliveryIssueView[];
}

export interface DeliveryCommandDeps {
  readonly resolveTarget?: BacklogTargetResolver;
}

function currentLanguage(): "en" | "zh" {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    configLang: configLang(),
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}

function msg(key: string, ...args: ReadonlyArray<string | number>): string {
  return t(v3Catalog, currentLanguage(), key, ...args);
}

export function deliveryUsage(): string {
  return msg("delivery.usage");
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameMergeMap(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort(compareCodeUnits);
  const rightKeys = Object.keys(right).sort(compareCodeUnits);
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && left[key] === right[key]
  );
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function readManifest(issueRoot: string, workspaceId: string, storyId: string): IssueManifest {
  const path = join(issueRoot, "manifest.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`invalid_issue:${storyId}`, { cause: error });
  }
  const parsed = parseIssueManifest(raw, { workspaceId, storyId });
  if (!parsed.ok) throw new Error(`invalid_issue:${storyId}`);
  return parsed.value;
}

function safeIssueRoot(workspaceRoot: string, storyId: string): string {
  const canonicalWorkspace = realpathSync(workspaceRoot);
  const issueRoot = join(canonicalWorkspace, "issues", storyId);
  const stat = lstatSync(issueRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`invalid_issue:${storyId}`);
  const canonicalIssueRoot = realpathSync(issueRoot);
  if (!contained(canonicalWorkspace, canonicalIssueRoot)) throw new Error(`invalid_issue:${storyId}`);
  return canonicalIssueRoot;
}

function listIssueIds(workspaceRoot: string): readonly string[] {
  const issuesRoot = join(workspaceRoot, "issues");
  if (!existsSync(issuesRoot)) return [];
  const stat = lstatSync(issuesRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid_issue:issues");
  const ids: string[] = [];
  for (const entry of readdirSync(issuesRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`invalid_issue:${entry.name}`);
    if (!entry.isDirectory()) continue;
    if (!validateStoryId(entry.name).ok) throw new Error(`invalid_issue:${entry.name}`);
    ids.push(entry.name);
  }
  return ids.sort(compareCodeUnits);
}

function sanitizedFact(fact: RepositoryMergeEvidence): DeliveryRepositoryFact {
  if (fact.authority === "provider") {
    return {
      authority: fact.authority,
      cycleId: fact.cycleId,
      recordedAt: fact.recordedAt,
      ...(fact.prNumber === undefined ? {} : { prNumber: fact.prNumber }),
      prState: fact.prState,
      ci: fact.ci,
      ...(fact.mergeCommit === undefined ? {} : { mergeCommit: fact.mergeCommit }),
      ...(fact.mergedAt === undefined ? {} : { mergedAt: fact.mergedAt }),
    };
  }
  if (fact.authority === "integration_branch") {
    return {
      authority: fact.authority,
      cycleId: fact.cycleId,
      recordedAt: fact.recordedAt,
      reachable: fact.reachable,
      ...(fact.mergeCommit === undefined ? {} : { mergeCommit: fact.mergeCommit }),
    };
  }
  return {
    authority: fact.authority,
    cycleId: fact.cycleId,
    recordedAt: fact.recordedAt,
    state: fact.state,
    ...(fact.mergeCommit === undefined ? {} : { mergeCommit: fact.mergeCommit }),
  };
}

function acceptanceView(
  manifest: IssueManifest,
  projection: IssueCompletionProjection,
  acceptances: readonly IssueIntegrationAcceptanceEvidence[],
): DeliveryAcceptanceView {
  const latest = [...acceptances]
    .sort((left, right) => left.recordedAt - right.recordedAt)
    .at(-1);
  const expectedCommandDigest = manifest.integrationAcceptance === undefined
    ? undefined
    : integrationAcceptanceCommandDigest(manifest.integrationAcceptance.command);
  if (latest === undefined) {
    return {
      status: "missing",
      ...(expectedCommandDigest === undefined ? {} : { expectedCommandDigest }),
    };
  }
  const status: DeliveryAcceptanceStatus = latest.verdict !== "pass"
    ? "failed"
    : !sameMergeMap(latest.inputMergeCommits, projection.mergeCommits)
      ? "input_mismatch"
      : "pass";
  return {
    status,
    ...(expectedCommandDigest === undefined ? {} : { expectedCommandDigest }),
    inputMergeCommits: Object.fromEntries(
      Object.entries(latest.inputMergeCommits).sort(([left], [right]) => compareCodeUnits(left, right)),
    ),
    commandDigest: latest.commandDigest,
    profile: latest.profile,
    verdict: latest.verdict,
    artifactPath: latest.artifactPath,
    recordedAt: latest.recordedAt,
  };
}

export function readDeliveryIssue(
  workspaceRoot: string,
  workspaceId: string,
  storyId: string,
): DeliveryIssueView {
  const issueRoot = safeIssueRoot(workspaceRoot, storyId);
  const manifest = readManifest(issueRoot, workspaceId, storyId);
  const evidence = readIssueCompletionEvidence(issueRoot);
  const projection = deriveIssueCompletion({
    workspaceId,
    storyId,
    repositories: manifest.repositories.map((repository) => ({
      repoId: repository.repoId,
      required: repository.requiredDelivery,
    })),
    repositoryFacts: evidence.repositoryFacts,
    integrationAcceptances: evidence.integrationAcceptances,
    backlogDone: false,
  });
  const requiredTargets = manifest.repositories
    .filter((target): target is Extract<IssueManifest["repositories"][number], { access: "write" }> =>
      target.access === "write" && target.requiredDelivery
    )
    .sort((left, right) => compareCodeUnits(left.alias, right.alias));
  const repositories: DeliveryRepositoryView[] = requiredTargets.map((target) => {
    const completion = projection.repositories.find((candidate) => candidate.repoId === target.repoId);
    if (completion === undefined) throw new Error(`invalid_issue:${storyId}`);
    const facts = evidence.repositoryFacts
      .filter((fact) => fact.repoId === target.repoId)
      .sort((left, right) => left.recordedAt - right.recordedAt || compareCodeUnits(left.authority, right.authority))
      .map(sanitizedFact);
    return {
      repoId: target.repoId,
      alias: target.alias,
      access: "write",
      requiredDelivery: true,
      status: completion.status,
      ...(completion.authority === undefined ? {} : { authority: completion.authority }),
      ...(completion.mergeCommit === undefined ? {} : { mergeCommit: completion.mergeCommit }),
      facts,
    };
  });
  const integrationAcceptance = acceptanceView(manifest, projection, evidence.integrationAcceptances);
  const outstandingGates: DeliveryOutstandingGate[] = repositories.flatMap((repository) =>
    repository.status === "merged"
      ? []
      : [{ kind: "repository" as const, repoId: repository.repoId, status: repository.status }]
  );
  for (const conflict of projection.conflicts) outstandingGates.push({ kind: "conflict", ...conflict });
  if (repositories.length > 0 && repositories.every((repository) => repository.status === "merged") && integrationAcceptance.status !== "pass") {
    outstandingGates.push({ kind: "integration_acceptance", status: integrationAcceptance.status });
  }
  return {
    workspaceId,
    storyId,
    state: projection.state,
    repositories,
    mergeCommits: Object.fromEntries(
      Object.entries(projection.mergeCommits).sort(([left], [right]) => compareCodeUnits(left, right)),
    ),
    integrationAcceptance,
    conflicts: projection.conflicts,
    outstandingGates,
  };
}

export function readDeliveryWorkspace(target: {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly canonicalRoot: string;
}): DeliveryWorkspaceView {
  return {
    workspaceId: target.workspaceId,
    path: target.canonicalRoot,
    issues: listIssueIds(target.workspaceRoot).map((storyId) =>
      readDeliveryIssue(target.workspaceRoot, target.workspaceId, storyId)
    ),
  };
}

function targetFromAggregate(entry: BacklogAggregateEntry): ResolvedBacklogTarget {
  return {
    ok: true,
    workspaceId: entry.workspaceId,
    workspaceRoot: entry.workspaceRoot,
    canonicalRoot: entry.canonicalRoot,
    backlogPath: entry.backlogPath,
    storyRoot: join(entry.workspaceRoot, "backlog"),
    runtimeRoot: join(entry.workspaceRoot, "runtime"),
    configPath: join(entry.workspaceRoot, "runtime", "backlog-sync.yaml"),
  };
}

function errorMessage(code: string): string {
  if (code === "invalid_arguments" || code === "story_not_found" || code === "invalid_issue") {
    return msg(`delivery.error.${code}`);
  }
  return msg(`workspace.error.${code}`);
}

function emitError(
  code: string,
  json: boolean,
  candidates: readonly BacklogAggregateEntry[] = [],
  migrationCheckCommand?: string,
): number {
  const message = errorMessage(code);
  if (json) {
    process.stderr.write(`${JSON.stringify({
      schema: DELIVERY_ERROR_V1,
      error: {
        code,
        message,
        candidates: candidates.map((candidate) => ({
          workspaceId: candidate.workspaceId,
          path: candidate.canonicalRoot,
        })),
        ...(migrationCheckCommand === undefined ? {} : { migrationCheckCommand }),
      },
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`${msg("delivery.error.line", code, message)}\n`);
    if (candidates.length > 0) {
      process.stderr.write(`${msg("delivery.error.candidates", candidates.map((candidate) => `${candidate.workspaceId}=${candidate.workspaceRoot}`).join(", "))}\n`);
    }
    if (migrationCheckCommand !== undefined) process.stderr.write(`${msg("delivery.error.migration_command", migrationCheckCommand)}\n`);
  }
  return 1;
}

function emitTargetError(
  decision: Extract<BacklogTargetDecision, { readonly ok: false }>,
  json: boolean,
): number {
  return emitError(
    decision.code,
    json,
    decision.candidates,
    "migrationCheckCommand" in decision ? decision.migrationCheckCommand : undefined,
  );
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function positionalArgs(args: readonly string[], allowedFlags: ReadonlySet<string>): string[] | undefined {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace") {
      if (!allowedFlags.has(arg) || args[index + 1] === undefined) return undefined;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--")) {
      if (!allowedFlags.has(arg)) return undefined;
      continue;
    }
    if (arg !== undefined) positional.push(arg);
  }
  return positional;
}

function resolveTargets(
  args: readonly string[],
  operation: BacklogOperation,
  resolver: BacklogTargetResolver,
): BacklogTargetDecision {
  return resolver(args, operation);
}

function gateText(gate: DeliveryOutstandingGate): string {
  if (gate.kind === "repository") return `repository:${gate.repoId}:${gate.status}`;
  if (gate.kind === "integration_acceptance") return `integration_acceptance:${gate.status}`;
  return `conflict:${gate.repoId}:${gate.code}`;
}

function renderList(workspaces: readonly DeliveryWorkspaceView[]): string {
  const lines: string[] = [];
  for (const workspace of workspaces) {
    lines.push(msg("delivery.list.title", workspace.workspaceId, workspace.issues.length));
    lines.push(msg("delivery.list.header"));
    for (const issue of workspace.issues) {
      lines.push(`${issue.storyId}\t${issue.state}\t${issue.outstandingGates.map(gateText).join(",") || "-"}`);
    }
    if (workspace.issues.length === 0) lines.push(msg("delivery.list.empty"));
  }
  return `${lines.join("\n")}\n`;
}

function factText(fact: DeliveryRepositoryFact): string {
  if (fact.authority === "provider") {
    return [
      "provider",
      fact.prNumber === undefined ? "PR -" : `PR #${fact.prNumber}`,
      fact.prState,
      `CI ${fact.ci}`,
      fact.mergeCommit ?? "merge -",
    ].join(" · ");
  }
  if (fact.authority === "integration_branch") {
    return `integration_branch · reachable ${String(fact.reachable)} · ${fact.mergeCommit ?? "merge -"}`;
  }
  return `projection · ${fact.state} · ${fact.mergeCommit ?? "merge -"}`;
}

function renderShow(issue: DeliveryIssueView): string {
  const lines = [
    msg("delivery.show.title", issue.storyId, issue.workspaceId),
    msg("delivery.show.state", issue.state),
    msg("delivery.show.repositories"),
  ];
  for (const repository of issue.repositories) {
    lines.push(msg(
      "delivery.show.repository",
      repository.alias,
      repository.repoId,
      repository.status,
      repository.authority ?? "-",
      repository.mergeCommit ?? "-",
    ));
    for (const fact of repository.facts) lines.push(msg("delivery.show.fact", factText(fact)));
  }
  lines.push(msg(
    "delivery.show.acceptance",
    issue.integrationAcceptance.status,
    issue.integrationAcceptance.profile ?? "-",
    issue.integrationAcceptance.artifactPath ?? "-",
  ));
  lines.push(msg(
    "delivery.show.outstanding",
    issue.outstandingGates.map(gateText).join(", ") || "-",
  ));
  return `${lines.join("\n")}\n`;
}

function selectedWorkspaces(decision: Extract<BacklogTargetDecision, { readonly ok: true }>): readonly DeliveryWorkspaceView[] {
  if ("aggregate" in decision) {
    return decision.aggregate
      .map(targetFromAggregate)
      .sort((left, right) => compareCodeUnits(left.workspaceId, right.workspaceId))
      .map(readDeliveryWorkspace);
  }
  return [readDeliveryWorkspace(decision)];
}

function listCommand(args: readonly string[], resolver: BacklogTargetResolver): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args, new Set(["--workspace", "--all", "--json"]));
  if (positional === undefined || positional.length > 0 || (args.includes("--all") && args.includes("--workspace"))) {
    return emitError("invalid_arguments", json);
  }
  const decision = resolveTargets(args, "read", resolver);
  if (!decision.ok) return emitTargetError(decision, json);
  try {
    const workspaces = selectedWorkspaces(decision);
    process.stdout.write(json
      ? `${JSON.stringify({ schema: DELIVERY_LIST_V1, workspaces }, null, 2)}\n`
      : renderList(workspaces));
    return 0;
  } catch (error) {
    if (error instanceof IssueCompletionEvidenceError || String(error).includes("invalid_issue:")) {
      return emitError("invalid_issue", json);
    }
    throw error;
  }
}

function showCommand(args: readonly string[], resolver: BacklogTargetResolver): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args, new Set(["--workspace", "--json"]));
  const storyId = positional?.[0];
  if (positional === undefined || positional.length !== 1 || storyId === undefined || !validateStoryId(storyId).ok) {
    return emitError("invalid_arguments", json);
  }
  const decision = resolveTargets(args, "read", resolver);
  if (!decision.ok) return emitTargetError(decision, json);
  if ("aggregate" in decision) return emitError("invalid_arguments", json);
  const issuePath = join(decision.workspaceRoot, "issues", storyId);
  if (!existsSync(issuePath)) return emitError("story_not_found", json);
  try {
    const issue = readDeliveryIssue(decision.workspaceRoot, decision.workspaceId, storyId);
    process.stdout.write(json
      ? `${JSON.stringify({ schema: DELIVERY_VIEW_V1, issue }, null, 2)}\n`
      : renderShow(issue));
    return 0;
  } catch (error) {
    if (error instanceof IssueCompletionEvidenceError || String(error).includes("invalid_issue:")) {
      return emitError("invalid_issue", json);
    }
    throw error;
  }
}

export function reconcileWorkspaceDeliveries(
  args: readonly string[],
  resolver: BacklogTargetResolver = resolveBacklogCommandTarget,
): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args, new Set(["--workspace", "--dry-run", "--json", "--all"]));
  if (
    positional === undefined || positional.length > 1 || args.includes("--all") ||
    flagValue(args, "--workspace") === undefined ||
    (positional[0] !== undefined && !validateStoryId(positional[0]).ok)
  ) {
    return emitError(args.includes("--all") ? "all_requires_readonly" : "invalid_arguments", json);
  }
  const decision = resolveTargets(args, "mutation", resolver);
  if (!decision.ok) return emitTargetError(decision, json);
  if ("aggregate" in decision) return emitError("all_requires_readonly", json);
  try {
    const storyId = positional[0];
    const issues = storyId === undefined
      ? readDeliveryWorkspace(decision).issues
      : existsSync(join(decision.workspaceRoot, "issues", storyId))
        ? [readDeliveryIssue(decision.workspaceRoot, decision.workspaceId, storyId)]
        : [];
    if (storyId !== undefined && issues.length === 0) return emitError("story_not_found", json);
    const dryRun = args.includes("--dry-run");
    process.stdout.write(json
      ? `${JSON.stringify({
          schema: DELIVERY_RECONCILE_V1,
          workspaceId: decision.workspaceId,
          dryRun,
          changed: false,
          issues,
        }, null, 2)}\n`
      : `${msg("delivery.reconcile.title", decision.workspaceId, issues.length, dryRun ? msg("delivery.reconcile.dry_run") : msg("delivery.reconcile.applied"))}\n${renderList([{ workspaceId: decision.workspaceId, path: decision.canonicalRoot, issues }])}`);
    return 0;
  } catch (error) {
    if (error instanceof IssueCompletionEvidenceError || String(error).includes("invalid_issue:")) {
      return emitError("invalid_issue", json);
    }
    throw error;
  }
}

export function deliveryCommand(args: string[], deps: DeliveryCommandDeps = {}): number {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(deliveryUsage());
    return 0;
  }
  const resolver = deps.resolveTarget ?? resolveBacklogCommandTarget;
  const [subcommand, ...rest] = args;
  if (subcommand === "list") return listCommand(rest, resolver);
  if (subcommand === "show") return showCommand(rest, resolver);
  if (subcommand === "reconcile") return reconcileWorkspaceDeliveries(rest, resolver);
  return emitError("invalid_arguments", args.includes("--json"));
}
