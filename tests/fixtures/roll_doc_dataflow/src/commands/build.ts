import { readConfig, writeOutput } from "../../lib/utils/fs";
import type { BuildConfig } from "../cli/main";

export function buildProject(config: Record<string, string>): void {
  const projectConfig = readConfig(config.project || ".");
  const result = compileProject(projectConfig);
  writeOutput(config.outDir || "dist", result);
}

function compileProject(config: BuildConfig): string {
  // compile project source files
  return `built with ${config.target || "es2020"}`;
}
