import { parseGoalYaml, type GoalScope, type RollGoal } from "@roll/spec";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LoopGoalDeps {
  projectPath: () => string;
}

function realDeps(): LoopGoalDeps {
  return { projectPath: () => process.cwd() };
}

function goalPath(projectPath: string): string {
  return join(projectPath, ".roll", "loop", "goal.yaml");
}

function scopeLabel(scope: GoalScope): string {
  if (scope.kind === "all") return "all backlog";
  if (scope.kind === "epic") return `epic ${scope.epic}`;
  return `cards ${scope.cards.join(", ")}`;
}

function money(n: number | undefined): string {
  if (n === undefined) return "-";
  return `$${n.toFixed(2)}`;
}

function limitLabel(goal: RollGoal): string {
  const parts = [
    goal.limits.maxCycles !== undefined ? `max cycles ${goal.limits.maxCycles}` : "",
    goal.limits.maxHours !== undefined ? `max hours ${goal.limits.maxHours}` : "",
  ].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(", ") : "-";
}

function renderGoal(goal: RollGoal): string {
  const budget = money(goal.budgetUsd);
  const cost = money(goal.usage.costUsd);
  return [
    `Goal status / 目标状态: ${goal.status}`,
    `Scope / 范围: ${scopeLabel(goal.scope)}`,
    `Usage / 用量: cycles ${goal.usage.cycles}, cost ${cost} / ${budget}`,
    `Limits / 限制: ${limitLabel(goal)}`,
    `Last decision / 最近裁定: ${goal.lastDecisionReason ?? "-"}`,
    `Created / 创建: ${goal.createdAt}`,
    `Updated / 更新: ${goal.updatedAt}`,
    "",
  ].join("\n");
}

export async function loopGoalCommand(_args: string[], deps: LoopGoalDeps = realDeps()): Promise<number> {
  const project = deps.projectPath();
  const path = goalPath(project);
  if (!existsSync(path)) {
    process.stdout.write(
      `No active goal — .roll/loop/goal.yaml not found\n` +
        `当前没有 goal — 未找到 .roll/loop/goal.yaml\n`,
    );
    return 0;
  }
  try {
    process.stdout.write(renderGoal(parseGoalYaml(readFileSync(path, "utf8"))));
    return 0;
  } catch (e) {
    process.stderr.write(`[roll] goal.yaml invalid: ${(e as Error).message}\n`);
    return 1;
  }
}
