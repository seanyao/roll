# Pricing — Cost Visibility & Price Snapshots

Roll computes per-cycle costs at **public per-token pricing** — not your
subscription rate, but a comparable number you can track across projects and
agents. This doc covers the `roll prices` command, snapshot mechanism, and
how historical costs survive price changes.

## Where Costs Appear

The dashboard (`roll loop status` / `roll loop monitor`) shows two cost-related
columns per cycle:

| Column | What it means |
|--------|---------------|
| **model** | Agent + version used (e.g. `deepseek-v4-pro`, `claude-sonnet-4-6`). Drives which price rates apply. |
| **cost** | Cost computed at public per-token rates × token usage. Currency follows the vendor: `$` for Anthropic (USD), `¥` for DeepSeek and Kimi (CNY). |

Roll uses **price snapshots** (not hardcoded constants) to look up rates.
Snapshots live in `lib/prices/` under your Roll install directory.

## Supported Vendors

| Vendor | Currency | Source |
|--------|----------|--------|
| Anthropic (Claude) | USD | `platform.claude.com/docs/en/about-claude/pricing` |
| DeepSeek | CNY | `api-docs.deepseek.com/zh-cn/quick_start/pricing/` |
| Kimi (Moonshot) | CNY | `platform.kimi.com/docs/pricing/chat` |

## `roll prices` Command

```bash
roll prices show        # Print the current price table (all vendors)
roll prices refresh     # Fetch official pricing docs for all vendors, diff, write if changed
```

### `roll prices show`

Prints the active snapshots' metadata and a table of all known models with
their per-million-token rates:

```
in       Base input tokens
out      Output tokens
cw       Cache write tokens (billed at a premium over input)
cr       Cache read tokens (billed at a deep discount)
```

Rates are **per million tokens**, in the vendor's native currency.

### `roll prices refresh`

Fetches the official pricing page from each vendor, parses the rate table,
and diffs it against the latest local snapshot. Supports per-vendor refresh:
`roll prices refresh anthropic|deepseek|kimi`.

- **Rates changed** → writes a new snapshot file (`snapshot-YYYY-MM-DD.json`),
  prints a diff (red = removed, green = added), and the dashboard picks up the
  new rates on the next render.
- **No change** → prints `up to date` and exits.

If the network is down or the page can't be parsed, the command exits with an
error message — **existing snapshots are never overwritten by a failed fetch**.

## Price Snapshots

Each snapshot is a JSON file in `lib/prices/` named by date:

```
lib/prices/
  snapshot-2026-05-22.json
  snapshot-2026-06-01.json   ← written by refresh when rates changed
```

A snapshot contains:

| Field | Description |
|-------|-------------|
| `version` | ISO 8601 timestamp of when the snapshot was created |
| `effective_at` | Date the vendor started charging these rates |
| `source_url` | URL of the official pricing page used |
| `prices` | Dict of `model → {in, out, cache_create, cache_read}` rates per million tokens |

Snapshots are **never deleted** — every version is kept so you can audit which
rate table applied at any point in time.

## History Cost Solidification

When a loop cycle finishes, Roll writes **two extra fields** into the usage
event:

| Field | Purpose |
|-------|---------|
| `cost_list_usd` | The cost at that moment's prices — frozen forever |
| `prices_version` | Which snapshot version was used to compute it |

The dashboard reads `cost_list_usd` first when rendering historical cycles.
If the field is missing (cycles from before this feature shipped), it falls
back to computing with the *current* snapshot and appends a dim `[legacy]`
marker.

**Net effect:** vendor price changes, `roll prices refresh`, and Roll upgrades
never rewrite historical cycle costs. "What you actually spent" is a fact —
it stays put.

## FAQ

**Q: Does the cost column reflect my actual bill?**
No. It uses public per-token rates. If you're on a subscription (Claude Pro,
Team, etc.) your real cost is lower. Think of it as a comparable number.

**Q: What happens when prices change?**
Run `roll prices refresh`. If rates changed, a new snapshot is written and new
cycles use it. Old cycles keep their frozen `cost_list_usd`.

**Q: Can I add prices for a different vendor?**
Yes — `roll prices refresh --vendor deepseek` (or `kimi`). The `--vendor` flag
tells the fetcher which vendor's pricing page to scrape.
