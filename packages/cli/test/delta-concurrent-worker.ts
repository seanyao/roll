/**
 * Concurrent prepare worker for US-DELTA-003 subprocess lease contention test.
 * Run via: npx tsx delta-concurrent-worker.ts <projectDir> <resolutionPath> <barrierPath> <workerId>
 */
import { existsSync, readFileSync } from "node:fs";
import { deltaCommand } from "../src/commands/delta.js";

const [projectDir, resolutionPath, barrierPath] = process.argv.slice(2);

if (!projectDir || !resolutionPath || !barrierPath) {
  process.stderr.write("Usage: tsx delta-concurrent-worker.ts <projectDir> <resolutionPath> <barrierPath>\n");
  process.exit(2);
}

// Busy-wait for barrier file to contain "go"
while (true) {
  if (existsSync(barrierPath)) {
    try {
      const content = readFileSync(barrierPath, "utf8").trim();
      if (content === "go") break;
    } catch { /* retry */ }
  }
}
// Small random jitter to avoid exact same microsecond
await new Promise((r) => setTimeout(r, Math.random() * 10));

const saveCwd = process.cwd();
let code: number;
try {
  process.chdir(projectDir);
  code = deltaCommand([
    "prepare", "US-DELTA-CONCURRENT",
    "--trigger", "host-guided",
    "--topology", "delta-team",
    "--profile", "standard",
    "--preset", "local-preset",
    "--resolution", resolutionPath,
    "--json",
  ]);
} finally {
  process.chdir(saveCwd);
}

process.exit(code);
