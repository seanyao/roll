/** Shared difftest helpers. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");

/** Running bin/roll VERSION= value (the frozen oracle's own version). */
export function binRollVersion(): string {
  const m = /^VERSION="([^"]+)"/m.exec(readFileSync(join(REPO, "bin", "roll"), "utf8"));
  return m?.[1] ?? "0";
}

/**
 * Pre-seed bin/roll's update-check cache inside a fabricated ROLL_HOME so the
 * oracle never fetches GitHub releases/latest nor prints the upgrade nag —
 * keeps difftests deterministic regardless of remote release state.
 */
export function seedUpdateCheckCache(rollHome: string): void {
  mkdirSync(rollHome, { recursive: true });
  const v = binRollVersion();
  writeFileSync(join(rollHome, ".update-check"), `${Math.floor(Date.now() / 1000)} ${v} ${v}\n`);
}
