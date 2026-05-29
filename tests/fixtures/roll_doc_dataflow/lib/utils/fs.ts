import { loadFile, saveFile } from "../db/store";

export interface BuildConfig {
  target: string;
  entry: string;
}

export function readConfig(projectPath: string): BuildConfig {
  const raw = loadFile(`${projectPath}/roll.config.json`);
  return JSON.parse(raw || "{}") as BuildConfig;
}

export function writeOutput(outDir: string, content: string): void {
  saveFile(`${outDir}/output.js`, content);
}
