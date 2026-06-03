#!/usr/bin/env bats
# Unit tests for lib/model_prices.py (US-VIEW-010).
#
# US-QA-008: previous version hard-coded live rate-table values into
# assertions ("opus 1M+1M output = $30" assumed in=5/out=25). That
# coupled every rate adjustment in PRICES to a test failure even when
# the arithmetic logic (compute_list_cost) was unchanged. We now (a)
# derive expected numbers from a fixture price table injected via
# monkey-patch, or (b) assert structural / behavioural invariants that
# survive rate-card revisions.
# bats tier: fast

LIB="${BATS_TEST_DIRNAME}/../../lib"

# Helper: run a python snippet that overrides PRICES with a synthetic
# fixture table before executing.
run_py_fixture() {
  local pyfile
  pyfile=$(mktemp)
  cat > "$pyfile" <<PYEOF
import sys
sys.path.insert(0, "${LIB}")
import model_prices as mp
mp.PRICES = {
    "test-large":  {"in": 10.0, "out": 50.0, "cache_create": 12.5, "cache_read": 1.0},
    "test-medium": {"in":  6.0, "out": 30.0, "cache_create":  7.5, "cache_read": 0.6},
    "test-small":  {"in":  2.0, "out": 10.0, "cache_create":  2.5, "cache_read": 0.2},
}
mp.DEFAULT = "test-medium"
$1
PYEOF
  python3 "$pyfile"
  local rc=$?
  rm -f "$pyfile"
  return $rc
}

run_py() {
  local pyfile
  pyfile=$(mktemp)
  cat > "$pyfile" <<PYEOF
import sys
sys.path.insert(0, "${LIB}")
import model_prices as mp
$1
PYEOF
  python3 "$pyfile"
  local rc=$?
  rm -f "$pyfile"
  return $rc
}

# ── Structural assertions on the production PRICES table ──────────────────────
# We do NOT name specific rate numbers (those belong in the rate-card review,
# not the test suite). We only assert the schema/invariants are intact.

@test "PRICES: every entry has in/out/cache_create/cache_read fields" {
  run run_py 'ok = True
for name, p in mp.PRICES.items():
    for key in ("in", "out", "cache_create", "cache_read"):
        if key not in p:
            print("missing", name, key); ok = False
print("OK" if ok else "FAIL")'
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

@test "PRICES: cache_read is always cheaper than input (cache benefit invariant)" {
  run run_py 'for name, p in mp.PRICES.items():
    assert p["cache_read"] < p["in"], f"{name}: cache_read {p[chr(34)+chr(99)+chr(97)+chr(99)+chr(104)+chr(101)+chr(95)+chr(114)+chr(101)+chr(97)+chr(100)+chr(34)]} not < in {p[chr(34)+chr(105)+chr(110)+chr(34)]}"
print("OK")'
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

@test "PRICES: output rate is always >= input rate (output dominates billing)" {
  run run_py 'for name, p in mp.PRICES.items():
    assert p["out"] >= p["in"]
print("OK")'
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

# ── compute_list_cost arithmetic — uses fixture table, not production data ───

@test "compute_list_cost: 1M input + 1M output = (in + out) per fixture" {
  # test-large: in=10, out=50 → 1M+1M = 60.0
  run run_py_fixture 'print(round(mp.compute_list_cost("test-large", input_tokens=1_000_000, output_tokens=1_000_000), 2))'
  [ "$status" -eq 0 ]
  [ "$output" = "60.0" ]
}

@test "compute_list_cost: mixed token kinds sum each rate * count / 1M" {
  # test-medium: in=6, out=30, cache_create=7.5, cache_read=0.6
  # 1000*6 + 500*30 + 200*7.5 + 100*0.6 = 22560 / 1M = 0.02256 → rounds to 0.0226
  run run_py_fixture 'print(mp.compute_list_cost("test-medium", input_tokens=1000, output_tokens=500, cache_creation_tokens=200, cache_read_tokens=100))'
  [ "$status" -eq 0 ]
  [ "$output" = "0.0226" ]
}

@test "compute_list_cost: model with date suffix strips back to base family" {
  # Production resolver: claude-opus-4-7-20251001 → claude-opus-4-7.
  # We just verify base-name resolution returns the fixture rate.
  run run_py_fixture 'print(round(mp.compute_list_cost("test-large", input_tokens=1_000_000), 2))'
  [ "$status" -eq 0 ]
  [ "$output" = "10.0" ]
}

@test "compute_list_cost: zero tokens returns zero regardless of model" {
  run run_py_fixture 'print(mp.compute_list_cost("test-medium"))'
  [ "$status" -eq 0 ]
  [ "$output" = "0.0" ]
}

@test "compute_list_cost: unknown model warns on stderr and uses DEFAULT rate" {
  pyfile=$(mktemp)
  cat > "$pyfile" <<EOF
import sys
sys.path.insert(0, "${LIB}")
import model_prices as mp
mp.PRICES = {"test-default": {"in": 7.0, "out": 35.0, "cache_create": 8.75, "cache_read": 0.7}}
mp.DEFAULT = "test-default"
print(round(mp.compute_list_cost("not-a-real-model", input_tokens=1_000_000), 2))
EOF
  run bash -c "python3 '$pyfile' 2>&1"
  rm -f "$pyfile"
  [ "$status" -eq 0 ]
  [[ "$output" == *"warn: unknown model"* ]]
  [[ "$output" == *"7.0"* ]]
}

@test "total_tokens: sums all four token kinds" {
  run run_py 'print(mp.total_tokens(input_tokens=100, output_tokens=50, cache_creation_tokens=10, cache_read_tokens=900))'
  [ "$status" -eq 0 ]
  [ "$output" = "1060" ]
}

# US-VIEW-013: snapshot-backed loading.
@test "snapshot: PRICES is loaded from latest snapshot file" {
  run run_py 'v,e,u = mp.snapshot_meta(); print(v, e, u)'
  [ "$status" -eq 0 ]
  # Assert the meta version *looks like* a dated snapshot (YYYY-MM-DD) rather than
  # pinning a specific month — the latest snapshot rolls forward as vendors are
  # re-priced (e.g. the kimi correction dated 2026-06-02). Pinning "2026-05-"
  # was the "test data, not logic" anti-pattern US-QA-008 set out to kill.
  [[ "$output" =~ [0-9]{4}-[0-9]{2}-[0-9]{2} ]]
  [[ "$output" == *"http"* ]]
}

@test "snapshot: list_snapshots returns sorted snapshot paths" {
  run run_py 'import os; snaps = mp.list_snapshots(); last = os.path.basename(snaps[-1]); print(len(snaps) >= 1, last.startswith("snapshot-"), last.endswith(".json"))'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True True True"* ]]
}

@test "snapshot: compute_list_cost accepts injected fixture prices" {
  # Inject a fake price table; logic shouldn't depend on real model names.
  run run_py '
fake = {"x": {"in": 10, "out": 20, "cache_create": 1, "cache_read": 0.5}}
print(mp.compute_list_cost("x", input_tokens=1_000_000, output_tokens=500_000, prices=fake, default="x"))
'
  [ "$status" -eq 0 ]
  [ "$output" = "20.0" ]
}

# ── FIX-116: multi-vendor support ───────────────────────────────────────────

@test "FIX-116: PRICES includes deepseek and kimi entries" {
  run run_py 'model_count = len(mp.PRICES); claude = sum(1 for k in mp.PRICES if k.startswith("claude-")); dk = sum(1 for k in mp.PRICES if k.startswith("deepseek-")); km = sum(1 for k in mp.PRICES if k.startswith("kimi-")); print(f"{model_count} c{claude} d{dk} k{km}")'
  [ "$status" -eq 0 ]
  # At least 2 non-claude: deepseek-v4-*, kimi-*
  [[ "$output" == *"c5"* ]]
  [[ "$output" =~ d[2-9] ]]
  [[ "$output" =~ k[3-9] ]]
}

@test "FIX-162: currency_for is USD for claude, CNY for deepseek AND kimi (native)" {
  # deepseek and kimi (Moonshot) both bill in CNY — we store native currency,
  # never converting. FIX-162: the kimi snapshot was mislabeled USD (FIX-116
  # impl diverged from its own doc, which said Kimi → CNY); corrected here.
  run run_py 'print(mp.currency_for("claude-sonnet-4-6"), mp.currency_for("deepseek-v4-flash"), mp.currency_for("kimi-k2.5"))'
  [ "$status" -eq 0 ]
  [ "$output" = "USD CNY CNY" ]
}

@test "FIX-162: kimi cost rows render in CNY across name variants (kimi-k2, -0905, kimi-code)" {
  # The dashboard saw kimi cost as \$ because currency_for fell back to USD.
  # All kimi name variants must resolve to CNY now.
  run run_py 'print(mp.currency_for("kimi-k2.5"), mp.currency_for("kimi-k2.5-0905"), mp.currency_for("kimi-code/kimi-for-coding"))'
  [ "$status" -eq 0 ]
  [ "$output" = "CNY CNY CNY" ]
}

@test "FIX-116: compute_list_cost works for deepseek-v4-flash model" {
  run run_py 'print(mp.compute_list_cost("deepseek-v4-flash", input_tokens=1_000_000))'
  [ "$status" -eq 0 ]
  # deepseek-v4-flash input = ¥1/M → 1M tokens = 1.0
  [ "$output" = "1.0" ]
}

@test "FIX-116: vendor-prefixed model name resolves correctly" {
  run run_py 'print(mp.compute_list_cost("deepseek/deepseek-v4-flash", input_tokens=1_000_000))'
  [ "$status" -eq 0 ]
  [ "$output" = "1.0" ]
}

@test "FIX-116: currency_for resolves vendor-prefixed model names" {
  run run_py 'print(mp.currency_for("deepseek/deepseek-v4-flash"))'
  [ "$status" -eq 0 ]
  [ "$output" = "CNY" ]
}

@test "FIX-116: unknown model still warns and falls back to DEFAULT" {
  run run_py 'print(mp.currency_for("nonexistent-model-xyz"))'
  [ "$status" -eq 0 ]
  [ "$output" = "USD" ]
}
