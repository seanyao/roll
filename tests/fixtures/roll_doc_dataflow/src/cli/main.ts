// Entry file for the dataflow fixture
import { buildProject } from "../commands/build";

export function main(args: string[]): void {
  const config = parseArgs(args);
  buildProject(config);
}

function parseArgs(args: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      opts[key] = val || "true";
    }
  }
  return opts;
}
