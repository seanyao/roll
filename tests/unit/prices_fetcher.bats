#!/usr/bin/env bats
# Unit tests for lib/prices_fetcher.py (US-VIEW-013)

LIB="${BATS_TEST_DIRNAME}/../../lib"

setup() {
  TMP="$(mktemp -d)"
}

teardown() {
  rm -rf "$TMP"
}

run_py() {
  python3 -c "
import sys
sys.path.insert(0, '${LIB}')
import prices_fetcher as pf
$1
"
}

@test "parse_pricing_html: extracts model + 4-rate rows from table" {
  run run_py '
html = """
<table>
  <tr><th>Model</th><th>Input</th><th>Cache write</th><th>Cache read</th><th>Output</th></tr>
  <tr><td>Claude Opus 4.7 (claude-opus-4-7)</td><td>$5</td><td>$6.25</td><td>$0.50</td><td>$25</td></tr>
  <tr><td>Claude Sonnet 4.6 (claude-sonnet-4-6)</td><td>$3</td><td>$3.75</td><td>$0.30</td><td>$15</td></tr>
</table>
"""
p = pf.parse_pricing_html(html)
print(p["claude-opus-4-7"]["in"], p["claude-opus-4-7"]["out"])
print(p["claude-sonnet-4-6"]["cache_create"])
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"5.0 25.0"* ]]
  [[ "$output" == *"3.75"* ]]
}

@test "parse_pricing_html: raises ParseError when no price rows found" {
  run run_py '
try:
    pf.parse_pricing_html("<html><body>no prices here</body></html>")
    print("UNEXPECTED OK")
except pf.ParseError as e:
    print("ParseError:", str(e))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"ParseError"* ]]
}

@test "parse_pricing_html: ignores rows without 4 dollar values" {
  run run_py '
html = """
<table>
  <tr><td>Header row claude-opus-4-7</td></tr>
  <tr><td>Claude Opus 4.7 (claude-opus-4-7)</td><td>$5</td><td>$6.25</td><td>$0.50</td><td>$25</td></tr>
</table>
"""
p = pf.parse_pricing_html(html)
print(len(p), list(p.keys()))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"1"* ]]
  [[ "$output" == *"claude-opus-4-7"* ]]
}

@test "diff_prices: detects added / removed / changed entries" {
  run run_py '
old = {"a": {"in": 1.0, "out": 2.0, "cache_create": 0.1, "cache_read": 0.05}}
new = {"a": {"in": 1.0, "out": 3.0, "cache_create": 0.1, "cache_read": 0.05},
       "b": {"in": 4.0, "out": 5.0, "cache_create": 0.4, "cache_read": 0.2}}
d = pf.diff_prices(old, new)
kinds = [k[0] for k in d]
print("changed-out:", any(k == ("changed", "a", "out", 2.0, 3.0) for k in d))
print("added-b:", "added" in kinds)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"changed-out: True"* ]]
  [[ "$output" == *"added-b: True"* ]]
}

@test "diff_prices: empty when prices are identical" {
  run run_py '
p = {"x": {"in": 1.0, "out": 2.0, "cache_create": 0.1, "cache_read": 0.05}}
print(pf.diff_prices(p, dict(p)))
'
  [ "$status" -eq 0 ]
  [ "$output" = "[]" ]
}

@test "write_snapshot: writes JSON with required keys and prices" {
  run run_py "
import json, os
d = '${TMP}'
prices = {'x': {'in': 1.0, 'out': 2.0, 'cache_create': 0.1, 'cache_read': 0.05}}
path = pf.write_snapshot(prices, snapshot_dir=d, effective_at='2099-01-02', source_url='http://example/test')
data = json.load(open(path))
print('keys-ok:', all(k in data for k in ('version','effective_at','source_url','prices','default_model')))
print('default:', data['default_model'])
print('prices-x-in:', data['prices']['x']['in'])
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"keys-ok: True"* ]]
  [[ "$output" == *"prices-x-in: 1.0"* ]]
}

@test "refresh: first run with no prior snapshot writes baseline" {
  run run_py "
d = '${TMP}'
html = '<table><tr><td>claude-opus-4-7</td><td>\$5</td><td>\$6.25</td><td>\$0.50</td><td>\$25</td></tr></table>'
action, changes = pf.refresh(snapshot_dir=d, html=html)
print('action:', action.split(':')[0])
print('changes:', len(changes))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"action: first"* ]]
}

@test "refresh: identical HTML produces unchanged result" {
  run run_py "
d = '${TMP}'
html = '<table><tr><td>claude-opus-4-7</td><td>\$5</td><td>\$6.25</td><td>\$0.50</td><td>\$25</td></tr></table>'
pf.refresh(snapshot_dir=d, html=html)
action, changes = pf.refresh(snapshot_dir=d, html=html)
print('action:', action)
print('changes:', len(changes))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"action: unchanged"* ]]
  [[ "$output" == *"changes: 0"* ]]
}

@test "refresh: rate change vs prior snapshot writes new file + reports diff" {
  run run_py "
d = '${TMP}'
old = '<table><tr><td>claude-opus-4-7</td><td>\$15</td><td>\$18.75</td><td>\$1.5</td><td>\$75</td></tr></table>'
new = '<table><tr><td>claude-opus-4-7</td><td>\$5</td><td>\$6.25</td><td>\$0.50</td><td>\$25</td></tr></table>'
pf.refresh(snapshot_dir=d, html=old)
action, changes = pf.refresh(snapshot_dir=d, html=new)
print('action:', action.split(':')[0])
print('changes:', len(changes))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"action: written"* ]]
  [[ "$output" == *"changes: 4"* ]]
}

@test "fetch_pricing_html: network/url errors raise FetchError" {
  # Unreachable URL → FetchError
  run run_py '
try:
    pf.fetch_pricing_html("http://127.0.0.1:1/does-not-exist", timeout=1)
    print("UNEXPECTED OK")
except pf.FetchError as e:
    print("FetchError")
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"FetchError"* ]]
}

# ─── US-VIEW-023: vendor registry tests ───────────────────────────────────────

@test "parse_pricing_html: explicit anthropic vendor gives same result as default" {
  run run_py '
html = """
<table>
  <tr><td>Claude Opus 4.7 (claude-opus-4-7)</td><td>$5</td><td>$6.25</td><td>$0.50</td><td>$25</td></tr>
</table>
"""
default_p = pf.parse_pricing_html(html)
anthropic_p = pf.parse_pricing_html(html, vendor="anthropic")
print("equal:", default_p == anthropic_p)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"equal: True"* ]]
}

@test "parse_pricing_html: unknown vendor raises ParseError" {
  run run_py '
try:
    pf.parse_pricing_html("<html></html>", vendor="nonexistent")
    print("UNEXPECTED OK")
except pf.ParseError as e:
    print("ParseError:", str(e))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"ParseError:"* ]]
  [[ "$output" == *"unknown vendor"* ]]
}

@test "refresh: anthropic snapshot includes vendor and currency fields" {
  run run_py "
import json, os
d = '${TMP}'
html = '<table><tr><td>claude-opus-4-7</td><td>\$5</td><td>\$6.25</td><td>\$0.50</td><td>\$25</td></tr></table>'
pf.refresh(snapshot_dir=d, html=html)
files = [f for f in os.listdir(d) if f.startswith('snapshot-')]
print('files:', len(files))
data = json.load(open(os.path.join(d, files[0])))
print('vendor:', data.get('vendor'))
print('currency:', data.get('currency'))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"files: 1"* ]]
  [[ "$output" == *"vendor: anthropic"* ]]
  [[ "$output" == *"currency: USD"* ]]
}

@test "refresh: deepseek placeholder parser raises ParseError" {
  run run_py "
d = '${TMP}'
try:
    pf.refresh(snapshot_dir=d, vendor='deepseek', html='<html>deepseek</html>')
    print('UNEXPECTED OK')
except pf.ParseError as e:
    print('ParseError:', str(e))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ParseError:"* ]]
  [[ "$output" == *"deepseek parser not yet implemented"* ]]
}

@test "refresh: kimi placeholder parser raises ParseError" {
  run run_py "
d = '${TMP}'
try:
    pf.refresh(snapshot_dir=d, vendor='kimi', html='<html>kimi</html>')
    print('UNEXPECTED OK')
except pf.ParseError as e:
    print('ParseError:', str(e))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ParseError:"* ]]
  [[ "$output" == *"kimi parser not yet implemented"* ]]
}

@test "_latest_snapshot_path: filters by vendor suffix" {
  run run_py "
import os, json
d = '${TMP}'
# Write three snapshots: anthropic (no suffix), deepseek, kimi
for name, vendor, currency in [
    ('snapshot-2099-01-01.json', 'anthropic', 'USD'),
    ('snapshot-2099-01-02-deepseek.json', 'deepseek', 'CNY'),
    ('snapshot-2099-01-03-kimi.json', 'kimi', 'CNY'),
]:
    path = os.path.join(d, name)
    json.dump({'version':'2099-01-01','effective_at':'2099-01-01','source_url':'x','vendor':vendor,'currency':currency,'prices':{'m':{'in':1,'out':2,'cache_create':0.1,'cache_read':0.05}}}, open(path,'w'))

print('anthropic:', os.path.basename(pf._latest_snapshot_path(d, vendor='anthropic') or ''))
print('deepseek:', os.path.basename(pf._latest_snapshot_path(d, vendor='deepseek') or ''))
print('kimi:', os.path.basename(pf._latest_snapshot_path(d, vendor='kimi') or ''))
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"anthropic: snapshot-2099-01-01.json"* ]]
  [[ "$output" == *"deepseek: snapshot-2099-01-02-deepseek.json"* ]]
  [[ "$output" == *"kimi: snapshot-2099-01-03-kimi.json"* ]]
}

@test "VENDOR_REGISTRY: contains expected vendors with correct currencies" {
  run run_py '
print("anthropic:", pf.VENDOR_REGISTRY["anthropic"].currency)
print("deepseek:", pf.VENDOR_REGISTRY["deepseek"].currency)
print("kimi:", pf.VENDOR_REGISTRY["kimi"].currency)
print("keys:", sorted(pf.VENDOR_REGISTRY.keys()))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"anthropic: USD"* ]]
  [[ "$output" == *"deepseek: CNY"* ]]
  [[ "$output" == *"kimi: CNY"* ]]
  [[ "$output" == *"keys: ['anthropic', 'deepseek', 'kimi']"* ]]
}
