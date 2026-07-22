import { resolve } from "node:path";
import { planHistoricalWorkspaceMigration } from "@roll/core";
import {
  collectHistoricalMigrationFacts,
  type CollectHistoricalMigrationFactsInput,
} from "@roll/infra";
import {
  resolveLang,
  t,
  v3Catalog,
  type HistoricalMigrationFacts,
  type HistoricalMigrationFinding,
  type HistoricalMigrationPlan,
  type Lang,
} from "@roll/spec";
import { configLang } from "./lang.js";
import { workspaceRollHome } from "./workspace-target.js";

export interface WorkspaceMigrateDeps {
  readonly collectFacts: (input: CollectHistoricalMigrationFactsInput) => Promise<HistoricalMigrationFacts>;
  readonly plan: (facts: HistoricalMigrationFacts) => HistoricalMigrationPlan;
}

interface ParsedArguments {
  readonly sourceRoot: string;
  readonly workspaceId?: string;
  readonly json: boolean;
}

function lang(): Lang {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    configLang: configLang(),
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}

function msg(key: string, ...args: ReadonlyArray<string | number>): string {
  return t(v3Catalog, lang(), key, ...args);
}

function parse(args: readonly string[]): ParsedArguments | null {
  const allowed = new Set(["--from", "--check", "--workspace", "--json"]);
  let sourceRoot: string | undefined;
  let workspaceId: string | undefined;
  let check = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || !allowed.has(arg)) return null;
    if (arg === "--check") {
      if (check) return null;
      check = true;
      continue;
    }
    if (arg === "--json") {
      if (json) return null;
      json = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("-") || value.trim() === "") return null;
    index += 1;
    if (arg === "--from") {
      if (sourceRoot !== undefined) return null;
      sourceRoot = resolve(value);
    } else {
      if (workspaceId !== undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) return null;
      workspaceId = value;
    }
  }
  if (!check || sourceRoot === undefined) return null;
  return { sourceRoot, ...(workspaceId === undefined ? {} : { workspaceId }), json };
}

function findingText(finding: HistoricalMigrationFinding): string {
  const detail = finding.path === undefined ? "" : msg("workspace.migrate.finding.path", finding.path);
  return msg(
    "workspace.migrate.finding.line",
    msg(`workspace.migrate.severity.${finding.severity}`),
    msg(`workspace.migrate.finding.${finding.code}`),
    detail,
  ).trimEnd();
}

function renderPlan(plan: HistoricalMigrationPlan, sourceRoot: string): string {
  const lines = [
    msg("workspace.migrate.title", msg(`workspace.migrate.verdict.${plan.verdict}`)),
    msg("workspace.migrate.source", sourceRoot),
    msg("workspace.migrate.workspace", plan.workspaceId, plan.workspaceRoot),
    msg("workspace.migrate.repository", plan.repository.repoId, plan.repository.alias),
    msg("workspace.migrate.branch", plan.repository.integrationBranch ?? msg("workspace.migrate.none")),
    msg("workspace.migrate.cache", plan.repository.cachePath),
    msg("workspace.migrate.plan_id", plan.planId),
    msg("workspace.migrate.mappings", plan.mappings.length),
    msg("workspace.migrate.findings", plan.findings.length),
    ...plan.findings.map(findingText),
  ];
  if (plan.verdict === "repository_cutover_required") {
    lines.push(
      msg("workspace.migrate.cutover", plan.repositoryCutover.sourceHead, plan.repositoryCutover.trackedEntries.length),
      msg("workspace.migrate.cutover.next"),
    );
  }
  if (plan.verdict === "manual_metadata_handoff") {
    const handoff = plan.manualHandoff;
    lines.push(
      msg("workspace.migrate.handoff.gitdir", handoff.gitdirToken),
      msg("workspace.migrate.handoff.toplevel", handoff.topLevelToken),
      msg("workspace.migrate.handoff.state", handoff.state),
      msg("workspace.migrate.handoff.head", handoff.head),
      msg("workspace.migrate.handoff.branch", handoff.branch ?? msg("workspace.migrate.none")),
      msg("workspace.migrate.handoff.upstream", handoff.upstream ?? msg("workspace.migrate.none")),
      msg("workspace.migrate.handoff.remote", handoff.normalizedRemote ?? msg("workspace.migrate.none")),
      msg("workspace.migrate.handoff.boundary"),
    );
  }
  return `${lines.join("\n")}\n`;
}

function emitError(code: "invalid_arguments" | "collection_failed", json: boolean): number {
  const message = msg(`workspace.migrate.error.${code}`);
  if (json) {
    process.stderr.write(`${JSON.stringify({
      schema: "roll.workspace-migration-error/v1",
      error: { code, message },
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`${msg("workspace.migrate.error.line", code, message)}\n`);
  }
  return 1;
}

const defaultDeps: WorkspaceMigrateDeps = {
  collectFacts: collectHistoricalMigrationFacts,
  plan: planHistoricalWorkspaceMigration,
};

/** Check one repository-local historical Roll project and emit its closed migration plan without writes. */
export async function workspaceMigrateCommand(
  args: readonly string[],
  deps: WorkspaceMigrateDeps = defaultDeps,
): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(msg("workspace.migrate.usage"));
    return 0;
  }
  const parsed = parse(args);
  if (parsed === null) return emitError("invalid_arguments", args.includes("--json"));
  try {
    const facts = await deps.collectFacts({
      sourceRoot: parsed.sourceRoot,
      rollHome: workspaceRollHome(),
      ...(parsed.workspaceId === undefined ? {} : { requestedWorkspaceId: parsed.workspaceId }),
    });
    const plan = deps.plan(facts);
    process.stdout.write(parsed.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan, facts.sourceRoot));
    return plan.verdict === "migration_blocked" ? 2 : 0;
  } catch {
    return emitError("collection_failed", parsed.json);
  }
}
