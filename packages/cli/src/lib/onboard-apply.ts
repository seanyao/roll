import { spawnSync } from "node:child_process";
import { collectInitFacts, type InitFacts } from "./init-diagnosis.js";
import { computeInitFactsHash } from "./onboard-plan.js";

export interface OnboardApplyPreflightDeps {
  collectFacts?: (projectDir: string) => InitFacts;
  readPlanFactsHash?: (planPath: string) => string | null;
}

export interface OnboardApplyPreflightResult {
  ok: boolean;
  errors: string[];
  currentFactsHash?: string;
  planFactsHash?: string;
}

export function readPlanFactsHash(planPath: string): string | null {
  const script = `
import json, sys, yaml
p = yaml.safe_load(open(sys.argv[1], encoding="utf-8")) or {}
value = p.get("factsHash")
print(json.dumps(value if isinstance(value, str) else None))
`;
  const result = spawnSync("python3", ["-c", script, planPath], { encoding: "utf8" });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function validateOnboardApplyPreflight(
  projectDir: string,
  planPath: string,
  deps: OnboardApplyPreflightDeps = {},
): OnboardApplyPreflightResult {
  const facts = deps.collectFacts?.(projectDir) ?? collectInitFacts(projectDir, { ignoreOnboardArtifacts: true });
  const currentFactsHash = computeInitFactsHash(facts);
  const planFactsHash = (deps.readPlanFactsHash ?? readPlanFactsHash)(planPath);
  const errors: string[] = [];
  if (planFactsHash === null) errors.push("could not read factsHash from .roll/onboard-plan.yaml");
  else if (planFactsHash !== currentFactsHash) {
    errors.push(`plan factsHash is stale: expected ${currentFactsHash}, got ${planFactsHash}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    currentFactsHash,
    ...(planFactsHash !== null ? { planFactsHash } : {}),
  };
}
