/** Shared difftest helpers. */
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");

/**
 * Build a PATH whose toolchain is /usr/bin + /bin MINUS `gh` (and any other
 * excluded binaries). On macOS dev boxes `/usr/bin` has no gh so a plain
 * "/usr/bin:/bin" suffices — but GitHub ubuntu runners SHIP gh in /usr/bin,
 * which silently un-fabricates every "no gh on PATH" fixture. The farm makes
 * "absent" mean absent on every platform.
 */
let noGhPathCache: string | undefined;
export function pathWithout(...exclude: string[]): string {
  const key = exclude.sort().join(",");
  if (key === "gh" && noGhPathCache !== undefined) return noGhPathCache;
  const farm = join(
    tmpdir(),
    `roll-toolfarm-${key.replace(/[^a-z0-9]/gi, "_")}-${process.pid}`,
  );
  mkdirSync(farm, { recursive: true });
  const banned = new Set(exclude);
  for (const dir of ["/usr/bin", "/bin"]) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (banned.has(name)) continue;
      try {
        symlinkSync(join(dir, name), join(farm, name));
      } catch {
        /* exists from a prior call — fine */
      }
    }
  }
  if (key === "gh") noGhPathCache = farm;
  return farm;
}

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
