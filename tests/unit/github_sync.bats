#!/usr/bin/env bats
# Unit tests for lib/github_sync.py (US-SYNC-001):
# GitHub Issues API client + auth + rate-limit handling.
# Mocks the HTTP layer via the injectable `opener` so no network is touched.
# bats tier: fast

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
import github_sync as gs
from urllib.request import Request

class FakeResp:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.body = body

$1
"
}

# --- Auth (env first, gh fallback, error) ------------------------------------

@test "US-SYNC-001: resolve_token prefers \$GITHUB_TOKEN" {
  run run_py '
tok = gs.resolve_token(env={"GITHUB_TOKEN": "env-tok"},
                       gh_token_fn=lambda: "gh-tok")
print("TOKEN:", tok)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"TOKEN: env-tok"* ]]
}

@test "US-SYNC-001: resolve_token falls back to gh auth token" {
  run run_py '
tok = gs.resolve_token(env={}, gh_token_fn=lambda: "gh-tok")
print("TOKEN:", tok)
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"TOKEN: gh-tok"* ]]
}

@test "US-SYNC-001: resolve_token raises AuthError with hint when nothing configured" {
  run run_py '
try:
    gs.resolve_token(env={}, gh_token_fn=lambda: None)
    print("UNEXPECTED OK")
except gs.AuthError as e:
    print("AuthError")
    print("HINT:", "GITHUB_TOKEN" in str(e) and "gh auth login" in str(e))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"AuthError"* ]]
  [[ "$output" == *"HINT: True"* ]]
}

# --- Pagination (Link header following) --------------------------------------

@test "US-SYNC-001: fetch_issues follows Link rel=next across pages" {
  run run_py '
page1 = "[{\"number\":1,\"title\":\"a\",\"state\":\"open\"}]"
page2 = "[{\"number\":2,\"title\":\"b\",\"state\":\"closed\"}]"
calls = []
def opener(req, timeout):
    calls.append(req.full_url)
    if len(calls) == 1:
        link = "<https://api.github.com/repos/o/r/issues?page=2>; rel=\"next\""
        return FakeResp(200, {"Link": link, "X-RateLimit-Remaining": "100"}, page1)
    return FakeResp(200, {"X-RateLimit-Remaining": "99"}, page2)
issues = gs.fetch_issues("o", "r", token="t", opener=opener)
print("COUNT:", len(issues))
print("NUMS:", [i["number"] for i in issues])
print("PAGES:", len(calls))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"COUNT: 2"* ]]
  [[ "$output" == *"NUMS: [1, 2]"* ]]
  [[ "$output" == *"PAGES: 2"* ]]
}

@test "US-SYNC-001: fetch_issues filters out pull requests" {
  run run_py '
body = "[{\"number\":1,\"title\":\"iss\",\"state\":\"open\"},{\"number\":2,\"title\":\"pr\",\"state\":\"open\",\"pull_request\":{\"url\":\"x\"}}]"
def opener(req, timeout):
    return FakeResp(200, {"X-RateLimit-Remaining": "100"}, body)
issues = gs.fetch_issues("o", "r", token="t", opener=opener)
print("NUMS:", [i["number"] for i in issues])
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"NUMS: [1]"* ]]
}

# --- Rate limiting -----------------------------------------------------------

@test "US-SYNC-001: HTTP 429 raises RateLimitError" {
  run run_py '
def opener(req, timeout):
    return FakeResp(429, {}, "")
try:
    gs.fetch_issues("o", "r", token="t", opener=opener)
    print("UNEXPECTED OK")
except gs.RateLimitError as e:
    print("RateLimitError")
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"RateLimitError"* ]]
}

@test "US-SYNC-001: low remaining quota warns and backs off" {
  run run_py '
warnings = []
slept = []
page1 = "[{\"number\":1,\"title\":\"a\",\"state\":\"open\"}]"
page2 = "[{\"number\":2,\"title\":\"b\",\"state\":\"open\"}]"
calls = []
def opener(req, timeout):
    calls.append(1)
    if len(calls) == 1:
        link = "<https://api.github.com/repos/o/r/issues?page=2>; rel=\"next\""
        return FakeResp(200, {"Link": link, "X-RateLimit-Remaining": "2"}, page1)
    return FakeResp(200, {"X-RateLimit-Remaining": "1"}, page2)
issues = gs.fetch_issues("o", "r", token="t", opener=opener,
                         warn=lambda m: warnings.append(m),
                         sleep=lambda s: slept.append(s))
print("WARNED:", len(warnings) >= 1)
print("SLEPT:", len(slept) >= 1)
print("COUNT:", len(issues))
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNED: True"* ]]
  [[ "$output" == *"SLEPT: True"* ]]
  [[ "$output" == *"COUNT: 2"* ]]
}

@test "US-SYNC-001: exhausted quota (remaining 0) raises RateLimitError" {
  run run_py '
def opener(req, timeout):
    return FakeResp(200, {"X-RateLimit-Remaining": "0"}, "[]")
try:
    gs.fetch_issues("o", "r", token="t", opener=opener)
    print("UNEXPECTED OK")
except gs.RateLimitError:
    print("RateLimitError")
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"RateLimitError"* ]]
}

@test "US-SYNC-001: HTTP 401 raises AuthError" {
  run run_py '
def opener(req, timeout):
    return FakeResp(401, {}, "")
try:
    gs.fetch_issues("o", "r", token="bad", opener=opener)
    print("UNEXPECTED OK")
except gs.AuthError:
    print("AuthError")
'
  [ "$status" -eq 0 ]
  [[ "$output" == *"AuthError"* ]]
}
