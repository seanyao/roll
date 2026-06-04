/**
 * Cost/currency resolution — TS port of lib/model_prices.py's _resolve /
 * _resolve_name / compute_list_cost / currency_for. Loads the same versioned
 * snapshots under lib/prices/ and merges later-overrides-earlier, injecting
 * a per-model currency. Used by the loop dashboard's usage backfill.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../bridge.js";

interface Snapshot {
  version: string;
  effective_at: string;
  source_url: string;
  prices: Record<string, Record<string, number>>;
  default_model: string;
  currency: string;
}

interface PriceTable {
  prices: Record<string, Record<string, number>>;
  currency: Record<string, string>;
  default: string;
}

let cached: PriceTable | null = null;

function loadTable(): PriceTable {
  if (cached !== null) return cached;
  const dir = join(repoRoot(), "lib", "prices");
  if (!existsSync(dir)) {
    throw new Error(`no price snapshots found in ${dir}; run \`roll prices refresh\``);
  }
  const files = readdirSync(dir)
    .filter((n) => n.startsWith("snapshot-") && n.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no price snapshots found in ${dir}; run \`roll prices refresh\``);
  }
  const snaps: Snapshot[] = files.map((name) => {
    const data = JSON.parse(readFileSync(join(dir, name), "utf8")) as Partial<Snapshot>;
    const prices = (data.prices ?? {}) as Snapshot["prices"];
    return {
      version: data.version ?? "",
      effective_at: data.effective_at ?? "",
      source_url: data.source_url ?? "",
      prices,
      default_model: data.default_model ?? Object.keys(prices)[0] ?? "",
      currency: data.currency ?? "USD",
    };
  });
  const prices: Record<string, Record<string, number>> = {};
  const currency: Record<string, string> = {};
  for (const snap of snaps) {
    for (const [model, rates] of Object.entries(snap.prices)) {
      prices[model] = { ...rates };
      currency[model] = snap.currency;
    }
  }
  const last = snaps[snaps.length - 1];
  cached = { prices, currency, default: last ? last.default_model : "" };
  return cached;
}

/** Mirror python str.rstrip("0123456789-"). */
function rstripDigitsDash(s: string): string {
  let end = s.length;
  while (end > 0) {
    const ch = s[end - 1] ?? "";
    if ((ch >= "0" && ch <= "9") || ch === "-") end--;
    else break;
  }
  return s.slice(0, end);
}

const NO_CURRENCY_MATCH = "\x00__no_currency_match__\x00";

function resolveName(
  model: string | null | undefined,
  table: Record<string, Record<string, number>>,
  fallback: string,
): string {
  if (!model) return fallback;
  const base = rstripDigitsDash(model.split("[")[0] ?? "");
  const candidates = Object.keys(table).filter(
    (k) => model.startsWith(k) || base.startsWith(k),
  );
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (b.length > a.length ? b : a));
  }
  if (model.includes("/")) {
    const inner = model.split("/").slice(1).join("/");
    const innerBase = rstripDigitsDash(inner.split("[")[0] ?? "");
    for (const k of Object.keys(table)) {
      if (inner === k || innerBase === k || inner.startsWith(k) || innerBase.startsWith(k)) {
        return k;
      }
    }
  }
  return fallback;
}

function resolve(
  model: string | null | undefined,
  table: Record<string, Record<string, number>>,
  fallback: string,
): Record<string, number> {
  if (!model) return table[fallback] ?? {};
  const base = rstripDigitsDash(model.split("[")[0] ?? "");
  const candidates = Object.keys(table).filter(
    (k) => model.startsWith(k) || base.startsWith(k),
  );
  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (b.length > a.length ? b : a));
    return table[best] ?? {};
  }
  if (model.includes("/")) {
    const inner = model.split("/").slice(1).join("/");
    const innerBase = rstripDigitsDash(inner.split("[")[0] ?? "");
    for (const k of Object.keys(table)) {
      if (inner === k || innerBase === k || inner.startsWith(k) || innerBase.startsWith(k)) {
        return table[k] ?? {};
      }
    }
  }
  return table[fallback] ?? {};
}

export function currencyFor(model: string | null | undefined): string {
  const tbl = loadTable();
  const name = resolveName(model, tbl.prices, NO_CURRENCY_MATCH);
  if (name === NO_CURRENCY_MATCH) return "USD";
  return tbl.currency[name] ?? "USD";
}

/** round-half-to-even to 4 decimals (mirror python round(total, 4)). */
function round4(x: number): number {
  const scaled = x * 10000;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const eps = 1e-9;
  let r: number;
  if (Math.abs(frac - 0.5) < eps) r = floor % 2 === 0 ? floor : floor + 1;
  else r = Math.round(scaled);
  return r / 10000;
}

export function computeListCost(
  model: string | null | undefined,
  opts: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
  } = {},
): number {
  const tbl = loadTable();
  const p = resolve(model, tbl.prices, tbl.default);
  const inT = opts.input_tokens ?? 0;
  const outT = opts.output_tokens ?? 0;
  const cwT = opts.cache_creation_tokens ?? 0;
  const crT = opts.cache_read_tokens ?? 0;
  const total =
    (inT * (p["in"] ?? 0) +
      outT * (p["out"] ?? 0) +
      cwT * (p["cache_create"] ?? 0) +
      crT * (p["cache_read"] ?? 0)) /
    1_000_000;
  return round4(total);
}
