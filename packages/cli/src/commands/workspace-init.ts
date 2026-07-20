import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseWorkspaceInitConfig, type WorkspaceInitPlan } from "@roll/core";
import {
  WorkspaceInitializationError,
  applyWorkspaceInitialization,
  inspectWorkspaceInitialization,
} from "@roll/infra";
import { resolveLang, t, v3Catalog, type Lang } from "@roll/spec";
import { configLang } from "./lang.js";

const RESULT_V1 = "roll.workspace-init-result/v1" as const;
const ERROR_V1 = "roll.workspace-init-error/v1" as const;

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

function emitError(code: string, json: boolean): number {
  const message = msg(`workspace.init.error.${code}`);
  if (json) {
    process.stderr.write(`${JSON.stringify({ schema: ERROR_V1, error: { code, message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`${msg("workspace.init.error.line", code, message)}\n`);
  }
  return 1;
}

function parseArgs(args: readonly string[]):
  | { readonly ok: true; readonly workspaceId: string; readonly configPath: string; readonly check: boolean; readonly json: boolean }
  | { readonly ok: false; readonly json: boolean } {
  const json = args.includes("--json");
  const allowed = new Set(["--config", "--check", "--json"]);
  if (args.some((arg) => arg.startsWith("-") && !allowed.has(arg))) return { ok: false, json };
  const configIndex = args.indexOf("--config");
  if (configIndex < 0 || configIndex + 1 >= args.length) return { ok: false, json };
  const configPath = args[configIndex + 1];
  if (configPath === undefined || configPath.startsWith("-")) return { ok: false, json };
  const consumed = new Set([configIndex, configIndex + 1]);
  const positional = args.filter((arg, index) => !consumed.has(index) && arg !== "--check" && arg !== "--json");
  if (positional.length !== 1 || positional[0] === undefined) return { ok: false, json };
  return { ok: true, workspaceId: positional[0], configPath: resolve(configPath), check: args.includes("--check"), json };
}

function renderPlan(plan: WorkspaceInitPlan, mode: "check" | "apply"): string {
  const lines = [
    msg("workspace.init.title", plan.workspaceId, mode, plan.outcome),
    msg("workspace.init.root", plan.root),
    msg("workspace.init.header"),
    ...plan.steps.map((step) => `${step.action}\t${step.kind}\t${step.target}`),
  ];
  return `${lines.join("\n")}\n`;
}

function emitResult(plan: WorkspaceInitPlan, mode: "check" | "apply", json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_V1,
      mode,
      outcome: plan.outcome,
      workspaceId: plan.workspaceId,
      root: plan.root,
      steps: plan.steps,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(renderPlan(plan, mode));
  }
  return plan.outcome === "rejected" ? 1 : 0;
}

export async function workspaceInitCommand(args: string[]): Promise<number> {
  const parsedArgs = parseArgs(args);
  if (!parsedArgs.ok) return emitError("invalid_arguments", parsedArgs.json);
  let text: string;
  let mtime: string;
  try {
    text = readFileSync(parsedArgs.configPath, "utf8");
    mtime = statSync(parsedArgs.configPath).mtime.toISOString();
  } catch {
    return emitError("config_read_failed", parsedArgs.json);
  }
  const parsed = parseWorkspaceInitConfig(text, {
    workspaceId: parsedArgs.workspaceId,
    configPath: parsedArgs.configPath,
    homeDir: homedir(),
    rollHome: process.env["ROLL_HOME"] ?? resolve(homedir(), ".roll"),
    nowIso: mtime,
  });
  if (!parsed.ok) return emitError(parsed.errors[0]?.code ?? "invalid_config", parsedArgs.json);
  try {
    if (parsedArgs.check) {
      const plan = await inspectWorkspaceInitialization(parsed.value);
      return emitResult(plan, "check", parsedArgs.json);
    }
    const result = await applyWorkspaceInitialization(parsed.value);
    return emitResult(result.plan, "apply", parsedArgs.json);
  } catch (error) {
    if (error instanceof WorkspaceInitializationError) return emitError(error.code, parsedArgs.json);
    return emitError("apply_failed", parsedArgs.json);
  }
}

