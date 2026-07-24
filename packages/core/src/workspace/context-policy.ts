import type {
  WorkspaceContextConsumer,
  WorkspaceContextPolicy,
  WorkspaceContextPolicySurface,
  WorkspaceContextScope,
} from "@roll/spec";

export interface WorkspaceContextSurfaceInventoryItem {
  readonly surface: WorkspaceContextPolicySurface;
  readonly id: string;
  readonly operation: string;
  readonly supportsWorkspaceSelector?: boolean;
}

export type WorkspaceContextPolicyFindingCode =
  | "duplicate_inventory_key"
  | "duplicate_policy_key"
  | "missing_policy"
  | "orphan_policy"
  | "invalid_scope_consumer"
  | "invalid_fallback_scope"
  | "missing_fallback_rationale"
  | "selector_capability_mismatch";

export interface WorkspaceContextPolicyFinding {
  readonly code: WorkspaceContextPolicyFindingCode;
  readonly key: string;
  readonly message: string;
}

export interface WorkspaceContextCompatibilityMatrixV1 {
  readonly schema: "roll.workspace-context-compatibility-matrix/v1";
  readonly rows: readonly WorkspaceContextPolicy[];
}

const EXPECTED_CONSUMER: Readonly<Partial<Record<WorkspaceContextScope, WorkspaceContextConsumer>>> = {
  workspace_optional_read: "workspace",
  workspace_required_read: "workspace",
  workspace_required_mutation: "workspace",
  issue_required: "issue",
  repository_required: "repository",
};

function keyOf(item: Pick<WorkspaceContextSurfaceInventoryItem, "surface" | "id" | "operation">): string {
  return `${item.surface}:${item.id}:${item.operation}`;
}

function compareKeys(left: Pick<WorkspaceContextSurfaceInventoryItem, "surface" | "id" | "operation">, right: Pick<WorkspaceContextSurfaceInventoryItem, "surface" | "id" | "operation">): number {
  return keyOf(left).localeCompare(keyOf(right));
}

function duplicateKeys(items: readonly WorkspaceContextSurfaceInventoryItem[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

function duplicatePolicyKeys(items: readonly WorkspaceContextPolicy[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

export function auditWorkspaceContextPolicies(input: {
  readonly inventory: readonly WorkspaceContextSurfaceInventoryItem[];
  readonly policies: readonly WorkspaceContextPolicy[];
}): WorkspaceContextPolicyFinding[] {
  const findings: WorkspaceContextPolicyFinding[] = [];
  const inventoryByKey = new Map(input.inventory.map((item) => [keyOf(item), item]));
  const policyByKey = new Map(input.policies.map((policy) => [keyOf(policy), policy]));

  for (const key of duplicateKeys(input.inventory)) {
    findings.push({ code: "duplicate_inventory_key", key, message: `duplicate inventory key: ${key}` });
  }
  for (const key of duplicatePolicyKeys(input.policies)) {
    findings.push({ code: "duplicate_policy_key", key, message: `duplicate policy key: ${key}` });
  }
  for (const key of [...inventoryByKey.keys()].sort()) {
    if (!policyByKey.has(key)) findings.push({ code: "missing_policy", key, message: `missing policy: ${key}` });
  }
  for (const key of [...policyByKey.keys()].sort()) {
    if (!inventoryByKey.has(key)) findings.push({ code: "orphan_policy", key, message: `policy has no registered surface: ${key}` });
  }

  for (const policy of [...input.policies].sort(compareKeys)) {
    const key = keyOf(policy);
    const expectedConsumer = EXPECTED_CONSUMER[policy.scope];
    const validConsumer = expectedConsumer === undefined
      ? policy.contextConsumer === undefined
      : policy.contextConsumer === expectedConsumer;
    if (!validConsumer) {
      findings.push({
        code: "invalid_scope_consumer",
        key,
        message: `${key} scope '${policy.scope}' requires consumer '${expectedConsumer ?? "none"}'`,
      });
    }
    const allowsFallback = policy.allowsAmbientCwd || policy.allowsLegacyRollPath;
    if (allowsFallback && policy.scope !== "machine_only" && policy.scope !== "legacy_migration_only") {
      findings.push({
        code: "invalid_fallback_scope",
        key,
        message: `${key} may only allow ambient cwd or legacy paths in machine/migration scope`,
      });
    }
    if (allowsFallback && (policy.rationale ?? "").trim() === "") {
      findings.push({
        code: "missing_fallback_rationale",
        key,
        message: `${key} fallback permission requires a rationale`,
      });
    }
    const inventoryItem = inventoryByKey.get(key);
    const acceptsSelector = policy.acceptsWorkspaceSelector === true;
    const supportsSelector = policy.surface === "cli" && inventoryItem?.supportsWorkspaceSelector === true;
    if (acceptsSelector !== supportsSelector) {
      findings.push({
        code: "selector_capability_mismatch",
        key,
        message: `${key} selector policy (${acceptsSelector}) disagrees with handler capability (${supportsSelector})`,
      });
    }
  }

  return findings.sort((left, right) => {
    const key = left.key.localeCompare(right.key);
    return key !== 0 ? key : left.code.localeCompare(right.code);
  });
}

export function buildWorkspaceContextCompatibilityMatrix(input: {
  readonly inventory: readonly WorkspaceContextSurfaceInventoryItem[];
  readonly policies: readonly WorkspaceContextPolicy[];
}): WorkspaceContextCompatibilityMatrixV1 {
  const findings = auditWorkspaceContextPolicies(input);
  if (findings.length > 0) {
    throw new Error(`workspace-context-policy: ${findings.map((finding) => finding.message).join("; ")}`);
  }
  return {
    schema: "roll.workspace-context-compatibility-matrix/v1",
    rows: [...input.policies].sort(compareKeys),
  };
}
