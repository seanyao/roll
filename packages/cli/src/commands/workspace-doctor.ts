import { existsSync, readFileSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import {
  HUMAN_SOFT_LEASE_HOURS,
  diagnoseWorkspace,
  normalizeRequirementSourceReference,
  type WorkspaceDoctorProbe,
  type WorkspaceDoctorRepairAction,
  type WorkspaceDoctorReport,
} from "@roll/core";
import {
  auditRequirementArchive,
  inspectRepositoryCache,
  inspectRequirementProjection,
  issueWorktreeIdentity,
  readLockOwner,
  readWorkspace,
  resolveRepositoryCacheIdentity,
  workspaceRegistryTransactionPath,
  WorkspaceRegistry,
  WorkspaceRegistryError,
  type InspectedWorkspace,
} from "@roll/infra";
import {
  AGENT_CAPACITY_LEASE_SCHEMA,
  parseIssueManifest,
  resolveLang,
  t,
  v3Catalog,
  type AgentCapacityLease,
  type Lang,
  type WorkspaceManifest,
} from "@roll/spec";
import { configLang } from "./lang.js";
import { workspaceRollHome } from "./workspace-target.js";

const WORKSPACE_DOCTOR_ERROR_V1 = "roll.workspace-doctor-error/v1" as const;

type DoctorErrorCode = "invalid_arguments" | "not_found" | "invalid_workspace";

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

export function workspaceDoctorUsage(): string {
  return msg("workspace.doctor.usage");
}

function emitError(code: DoctorErrorCode, json: boolean): number {
  const message = msg(`workspace.doctor.error.${code}`);
  if (json) {
    process.stderr.write(`${JSON.stringify({
      schema: WORKSPACE_DOCTOR_ERROR_V1,
      error: { code, message },
    }, null, 2)}\n`);
    return 1;
  }
  process.stderr.write(`${msg("workspace.doctor.error.line", code, message)}\n`);
  return 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function actionToken(action: WorkspaceDoctorRepairAction): string {
  return `${action.kind}:${action.targetId}`;
}

function renderNextAction(report: WorkspaceDoctorReport): string {
  if (report.nextAction.kind === "none") return msg("workspace.doctor.next.none");
  if (report.nextAction.kind === "repair") {
    return `roll workspace doctor ${report.workspaceId} --repair ${actionToken(report.nextAction.action)}`;
  }
  return msg("workspace.doctor.next.owner", report.nextAction.code);
}

function renderHuman(report: WorkspaceDoctorReport): string {
  const lines = [
    msg("workspace.doctor.title", report.workspaceId, report.status),
    msg("workspace.doctor.header"),
  ];
  if (report.findings.length === 0) {
    lines.push(msg("workspace.doctor.healthy"));
  } else {
    for (const finding of report.findings) {
      const action = finding.repairAction === undefined
        ? msg("workspace.doctor.next.owner", finding.code)
        : actionToken(finding.repairAction);
      lines.push(`${finding.status}\t${finding.code}\t${finding.evidencePath}\t${action}`);
    }
  }
  lines.push(msg("workspace.doctor.next", renderNextAction(report)));
  return `${lines.join("\n")}\n`;
}

function emitReport(report: WorkspaceDoctorReport, json: boolean): number {
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report));
  return 0;
}

function registryReport(
  workspaceId: string,
  state: Extract<WorkspaceDoctorProbe, { kind: "registry" }>["state"],
): WorkspaceDoctorReport {
  return diagnoseWorkspace({
    workspaceId,
    probes: [{ kind: "registry", state, targetId: workspaceId, evidencePath: "workspaces.json" }],
  });
}

function inspectRegistry(rollHome: string, workspaceId: string):
  | { readonly report: WorkspaceDoctorReport }
  | { readonly entry: InspectedWorkspace } {
  const store = new WorkspaceRegistry({ rollHome });
  if (existsSync(workspaceRegistryTransactionPath(rollHome))) {
    try {
      store.read();
      return { report: registryReport(workspaceId, "pending_journal") };
    } catch {
      return { report: registryReport(workspaceId, "unsupported_schema") };
    }
  }
  try {
    const entry = store.inspect().find((candidate) => candidate.workspaceId === workspaceId);
    if (entry === undefined) throw new WorkspaceRegistryError("not_found", "Workspace is not registered");
    return { entry };
  } catch (error) {
    if (error instanceof WorkspaceRegistryError && error.code === "not_found") throw error;
    if (error instanceof WorkspaceRegistryError && error.code === "invalid_registry") {
      return { report: registryReport(workspaceId, "unsupported_schema") };
    }
    throw error;
  }
}

async function cacheProbes(rollHome: string, workspace: WorkspaceManifest): Promise<WorkspaceDoctorProbe[]> {
  const probes: WorkspaceDoctorProbe[] = [];
  for (const binding of workspace.repositories) {
    const state = await inspectRepositoryCache({ rollHome, binding });
    const identity = resolveRepositoryCacheIdentity({ rollHome, binding });
    probes.push({
      kind: "cache",
      state,
      targetId: binding.repoId,
      evidencePath: `repos/${basename(identity.cachePath)}`,
    });
  }
  return probes;
}

function requirementProbes(workspaceRoot: string, workspace: WorkspaceManifest): WorkspaceDoctorProbe[] {
  const probes: WorkspaceDoctorProbe[] = [];
  for (const declared of workspace.requirements) {
    const normalized = normalizeRequirementSourceReference(declared.provider, declared.ref);
    if (!normalized.ok) {
      probes.push({
        kind: "requirement_projection",
        state: "unsupported_schema",
        archiveStatus: "untrusted",
        targetId: "invalid-requirement",
        evidencePath: "requirements",
      });
      continue;
    }
    const { provider, requirementId } = normalized.value;
    const audit = auditRequirementArchive({ workspaceRoot, provider, requirementId });
    const projection = inspectRequirementProjection({ workspaceRoot, provider, requirementId });
    probes.push({
      kind: "requirement_projection",
      state: projection.state,
      archiveStatus: audit.status,
      targetId: requirementId,
      evidencePath: `requirements/${provider}/${requirementId}`,
    });
  }
  return probes;
}

function issueDirectories(workspaceRoot: string): readonly string[] {
  const root = join(workspaceRoot, "issues");
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function issueProbes(
  rollHome: string,
  workspaceRoot: string,
  workspace: WorkspaceManifest,
): Promise<WorkspaceDoctorProbe[]> {
  const probes: WorkspaceDoctorProbe[] = [];
  for (const storyId of issueDirectories(workspaceRoot)) {
    const issueRoot = join(workspaceRoot, "issues", storyId);
    const manifestPath = join(issueRoot, "manifest.json");
    const journal = existsSync(join(issueRoot, "issue-init.pending.json"));
    if (!existsSync(manifestPath)) {
      probes.push({
        kind: "issue",
        state: journal ? "partial_journal" : "unsupported_schema",
        targetId: storyId,
        evidencePath: `issues/${storyId}`,
      });
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      raw = undefined;
    }
    const parsed = parseIssueManifest(raw);
    if (!parsed.ok || parsed.value.workspaceId !== workspace.workspaceId || parsed.value.storyId !== storyId) {
      probes.push({ kind: "issue", state: "unsupported_schema", targetId: storyId, evidencePath: `issues/${storyId}/manifest.json` });
      continue;
    }
    if (journal) {
      probes.push({ kind: "issue", state: "partial_journal", targetId: storyId, evidencePath: `issues/${storyId}/issue-init.pending.json` });
    }
    for (const target of parsed.value.repositories) {
      const binding = workspace.repositories.find((candidate) =>
        candidate.repoId === target.repoId && candidate.alias === target.alias
      );
      const evidencePath = `issues/${storyId}/${target.alias}`;
      if (binding === undefined) {
        probes.push({ kind: "issue", state: "conflict", targetId: `${storyId}/${target.alias}`, evidencePath });
        continue;
      }
      const cache = resolveRepositoryCacheIdentity({ rollHome, binding });
      const identity = await issueWorktreeIdentity(join(issueRoot, target.alias), cache.cachePath);
      const state = identity.state === "absent"
        ? "missing_worktree"
        : identity.state === "conflict" ? "conflict" : identity.dirty ? "dirty_or_unpushed" : "compatible";
      probes.push({ kind: "issue", state, targetId: `${storyId}/${target.alias}`, evidencePath });
    }
  }
  return probes;
}

function runtimeLockProbes(workspaceRoot: string): WorkspaceDoctorProbe[] {
  const root = join(workspaceRoot, "runtime", "locks");
  const paths = ["cycle.lock", "go.lock", "inner.lock"];
  try {
    for (const entry of readdirSync(join(root, "requirements"))) paths.push(`requirements/${entry}`);
  } catch {
    // No Requirement capture locks.
  }
  const currentHost = hostname();
  const probes: WorkspaceDoctorProbe[] = [];
  for (const relativePath of paths.sort()) {
    const path = join(root, relativePath);
    if (!existsSync(path)) continue;
    const owner = readLockOwner(path);
    const state = owner === undefined
      ? "unreadable"
      : owner.hostname !== "" && owner.hostname !== currentHost
        ? "stale_live_or_foreign"
        : pidAlive(owner.pid) ? "active" : "stale_owned_dead";
    probes.push({ kind: "runtime_lock", state, targetId: relativePath, evidencePath: `runtime/locks/${relativePath}` });
  }
  const storyLeasePath = join(root, "story-leases.json");
  if (!existsSync(storyLeasePath)) return probes;
  let leases: unknown;
  try {
    leases = JSON.parse(readFileSync(storyLeasePath, "utf8"));
  } catch {
    leases = undefined;
  }
  if (!isRecord(leases)) {
    probes.push({ kind: "runtime_lock", state: "unsupported_schema", targetId: "story-leases", evidencePath: "runtime/locks/story-leases.json" });
    return probes;
  }
  for (const [storyId, value] of Object.entries(leases).sort(([left], [right]) => left.localeCompare(right))) {
    if (
      !isRecord(value) || typeof value["claimedAt"] !== "number" ||
      (value["source"] !== "cycle" && value["source"] !== "human" && value["source"] !== "supervisor") ||
      (value["pid"] !== undefined && typeof value["pid"] !== "number")
    ) {
      probes.push({ kind: "runtime_lock", state: "unsupported_schema", targetId: storyId, evidencePath: "runtime/locks/story-leases.json" });
      continue;
    }
    const source = value["source"];
    const pid = value["pid"];
    const staleHuman = source !== "cycle" && Date.now() - value["claimedAt"] > HUMAN_SOFT_LEASE_HOURS * 3_600_000;
    const state = source === "cycle" && typeof pid === "number"
      ? pidAlive(pid) ? "active" : "stale_owned_dead"
      : staleHuman ? "stale_live_or_foreign" : "active";
    probes.push({ kind: "runtime_lock", state, targetId: storyId, evidencePath: "runtime/locks/story-leases.json" });
  }
  return probes;
}

function isCapacityLease(value: unknown): value is AgentCapacityLease {
  if (!isRecord(value) || value["schema"] !== AGENT_CAPACITY_LEASE_SCHEMA) return false;
  const key = value["key"];
  const owner = value["owner"];
  return isRecord(key) && typeof key["agent"] === "string" && typeof key["model"] === "string" && typeof key["contextKey"] === "string" &&
    isRecord(owner) && typeof owner["leaseId"] === "string" && typeof owner["ownerToken"] === "string" &&
    typeof owner["workspaceId"] === "string" && typeof owner["storyId"] === "string" && typeof owner["cycleId"] === "string" &&
    typeof owner["spawnId"] === "string" && typeof owner["host"] === "string" && typeof owner["pid"] === "number" &&
    typeof owner["processStartedAtMs"] === "number" && typeof value["acquiredAtMs"] === "number" && typeof value["heartbeatAtMs"] === "number";
}

function capacityLeaseProbes(rollHome: string, workspaceId: string): WorkspaceDoctorProbe[] {
  const root = join(rollHome, "locks", "capacity", "leases");
  let names: string[];
  try {
    names = readdirSync(root).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const currentHost = hostname();
  const probes: WorkspaceDoctorProbe[] = [];
  for (const name of names) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(root, name), "utf8"));
    } catch {
      probes.push({ kind: "lease", state: "unreadable", targetId: basename(name, ".json"), evidencePath: `locks/capacity/leases/${name}` });
      continue;
    }
    if (!isCapacityLease(value)) {
      probes.push({ kind: "lease", state: "unsupported_schema", targetId: basename(name, ".json"), evidencePath: `locks/capacity/leases/${name}` });
      continue;
    }
    if (value.owner.workspaceId !== workspaceId) continue;
    const stale = Date.now() - value.heartbeatAtMs > 120_000;
    const state = !stale
      ? "active"
      : value.owner.host !== currentHost || pidAlive(value.owner.pid)
        ? "stale_live_or_foreign"
        : "stale_owned_dead";
    probes.push({ kind: "lease", state, targetId: value.owner.leaseId, evidencePath: `locks/capacity/leases/${name}` });
  }
  return probes;
}

async function diagnose(rollHome: string, entry: InspectedWorkspace): Promise<WorkspaceDoctorReport> {
  const registryState = entry.consistency === "consistent" ? "consistent" : entry.consistency;
  const probes: WorkspaceDoctorProbe[] = [{
    kind: "registry",
    state: registryState,
    targetId: entry.workspaceId,
    evidencePath: entry.consistency === "consistent" ? "workspace.yaml" : "workspaces.json",
  }];
  if (entry.consistency !== "consistent") return diagnoseWorkspace({ workspaceId: entry.workspaceId, probes });
  let workspace: WorkspaceManifest;
  try {
    workspace = readWorkspace(entry.root);
  } catch {
    return registryReport(entry.workspaceId, "invalid_manifest");
  }
  probes.push(...await cacheProbes(rollHome, workspace));
  probes.push(...requirementProbes(entry.root, workspace));
  probes.push(...await issueProbes(rollHome, entry.root, workspace));
  probes.push(...runtimeLockProbes(entry.root));
  probes.push(...capacityLeaseProbes(rollHome, entry.workspaceId));
  return diagnoseWorkspace({ workspaceId: entry.workspaceId, probes });
}

export async function workspaceDoctorCommand(args: readonly string[]): Promise<number> {
  const json = args.includes("--json");
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h" || args[0] === "help")) {
    process.stdout.write(workspaceDoctorUsage());
    return 0;
  }
  const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--json");
  const positional = args.filter((arg) => !arg.startsWith("-"));
  if (unknown.length > 0 || positional.length !== 1 || args.filter((arg) => arg === "--json").length > 1) {
    return emitError("invalid_arguments", json);
  }
  const workspaceId = positional[0];
  if (workspaceId === undefined || workspaceId === "") return emitError("invalid_arguments", json);
  const rollHome = workspaceRollHome();
  try {
    const registry = inspectRegistry(rollHome, workspaceId);
    if ("report" in registry) return emitReport(registry.report, json);
    return emitReport(await diagnose(rollHome, registry.entry), json);
  } catch (error) {
    if (error instanceof WorkspaceRegistryError && error.code === "not_found") return emitError("not_found", json);
    if (error instanceof WorkspaceRegistryError) return emitError("invalid_workspace", json);
    throw error;
  }
}
