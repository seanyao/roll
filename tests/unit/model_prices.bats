#!/usr/bin/env bats
# Unit tests for lib/model_prices.py (US-VIEW-010)

LIB="${BATS_TEST_DIRNAME}/../../lib"

run_py() {
  python3 -c "
import sys
sys.path.insert(0, '${LIB}')
import model_prices as mp
$1
"
}

@test "PRICES: claude-opus-4-7 uses opus rates (in=5, out=25)" {
  run run_py 'p = mp.PRICES["claude-opus-4-7"]; print(p["in"], p["out"])'
  [ "$status" -eq 0 ]
  [[ "$output" == *"5.0 25.0"* ]] || [[ "$output" == *"5 25"* ]]
}

@test "PRICES: claude-sonnet-4-6 uses sonnet rates (in=3, out=15)" {
  run run_py 'p = mp.PRICES["claude-sonnet-4-6"]; print(p["in"], p["out"])'
  [ "$status" -eq 0 ]
  [[ "$output" == *"3.0 15.0"* ]] || [[ "$output" == *"3 15"* ]]
}

@test "PRICES: claude-haiku-4-5 uses haiku rates (in=1, out=5)" {
  run run_py 'p = mp.PRICES["claude-haiku-4-5"]; print(p["in"], p["out"])'
  [ "$status" -eq 0 ]
  [[ "$output" == *"1.0 5.0"* ]] || [[ "$output" == *"1 5"* ]]
}

@test "compute_list_cost: opus 1M input + 1M output = \$30" {
  run run_py 'print(round(mp.compute_list_cost("claude-opus-4-7", input_tokens=1_000_000, output_tokens=1_000_000), 2))'
  [ "$status" -eq 0 ]
  [ "$output" = "30.0" ]
}

@test "compute_list_cost: sonnet mixed token kinds" {
  # 1000*3 + 500*15 + 200*3.75 + 122089*0.30 = 3000+7500+750+36626.7 = 47876.7 / 1e6 = 0.04788
  run run_py 'print(round(mp.compute_list_cost("claude-sonnet-4-6", input_tokens=1000, output_tokens=500, cache_creation_tokens=200, cache_read_tokens=122089), 4))'
  [ "$status" -eq 0 ]
  [ "$output" = "0.0479" ]
}

@test "compute_list_cost: claude-opus-4-7-20251001 (date suffix) resolves to opus rate" {
  run run_py 'print(round(mp.compute_list_cost("claude-opus-4-7-20251001", input_tokens=1_000_000), 2))'
  [ "$status" -eq 0 ]
  [ "$output" = "5.0" ]
}

@test "compute_list_cost: unknown model falls back to sonnet with stderr warn" {
  run bash -c "python3 -c \"
import sys
sys.path.insert(0, '${LIB}')
import model_prices as mp
print(round(mp.compute_list_cost('gpt-4-turbo', input_tokens=1_000_000), 2))
\" 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"warn: unknown model"* ]]
  [[ "$output" == *"3.0"* ]]
}

@test "compute_list_cost: zero tokens returns zero" {
  run run_py 'print(mp.compute_list_cost("claude-sonnet-4-6"))'
  [ "$status" -eq 0 ]
  [ "$output" = "0.0" ]
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
  [[ "$output" == *"2026-05-22"* ]]
  [[ "$output" == *"platform.claude.com"* ]]
}

@test "snapshot: list_snapshots returns sorted snapshot paths" {
  run run_py 'snaps = mp.list_snapshots(); print(len(snaps), snaps[-1].endswith("snapshot-2026-05-22.json"))'
  [ "$status" -eq 0 ]
  [[ "$output" == *"True"* ]]
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
