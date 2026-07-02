/** Shared difftest helpers. */
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");

const CJK_RE = /[\u4e00-\u9fff]/;
const EN_WORD_RE = /[A-Za-z]{2,}/;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripStableLiterals(line: string): string {
  return line
    .replace(ANSI_RE, "")
    .replace(/`[^`]*`/g, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .replace(/\broll\s+[a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)?\b/gi, " ")
    .replace(/\bconfig\s+lang\b/gi, " ")
    .replace(/\b[A-Z][A-Z0-9_-]+\b/g, " ")
    .replace(/--?[a-z][a-z0-9-]*/gi, " ")
    .replace(/\b(?:zh|en)\b/gi, " ");
}

function lineLanguage(line: string): "en" | "zh" | "mixed" | "none" {
  const scrubbed = stripStableLiterals(line);
  const hasCjk = CJK_RE.test(scrubbed);
  const hasEn = EN_WORD_RE.test(scrubbed);
  if (hasCjk && hasEn) return "mixed";
  if (hasCjk) return "zh";
  if (hasEn) return "en";
  return "none";
}

export function findAdjacentBilingualPairs(output: string): readonly string[] {
  const prose = output
    .split("\n")
    .map((raw, index) => ({ raw, index: index + 1, lang: lineLanguage(raw) }))
    .filter((line) => line.raw.trim() !== "" && (line.lang === "en" || line.lang === "zh"));
  const pairs: string[] = [];
  for (let i = 1; i < prose.length; i++) {
    const prev = prose[i - 1];
    const cur = prose[i];
    if (prev === undefined || cur === undefined) continue;
    if (prev.lang !== cur.lang) {
      pairs.push(`${prev.index}: ${prev.raw}\n${cur.index}: ${cur.raw}`);
    }
  }
  return pairs;
}

export function expectNoAdjacentBilingualPairs(output: string): void {
  const pairs = findAdjacentBilingualPairs(output);
  if (pairs.length > 0) {
    throw new Error(`Adjacent bilingual translation pairs found:\n${pairs.join("\n---\n")}`);
  }
}

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

/**
 * The running roll version (US-PORT-021): package.json is the single source of
 * truth — the v2-era bin/roll VERSION= fallback is retired with the bash engine.
 * The cache-seeding helpers below rely on this matching `$VERSION` so the upgrade
 * nag stays suppressed in difftests.
 */
export function binRollVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version !== "") return pkg.version;
  } catch {
    /* fall through */
  }
  return "0";
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
