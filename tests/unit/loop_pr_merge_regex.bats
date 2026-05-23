#!/usr/bin/env bats
# FIX-107: load_pr_merges_from_git must accept both squash-merge subject
# formats so dashboard promotes pr_outcome to 'merged' even when cycle_end
# fires before the PR finishes landing.
# bats tier: fast

LIB="${BATS_TEST_DIRNAME}/../../lib"
STATUS="${LIB}/roll-loop-status.py"

# Run load_pr_merges_from_git inside a synthetic git repo seeded with one
# merge commit shaped like the supplied subject. Returns "label PR#".
parse_one() {
  local subject="$1"
  local body="${2:-}"
  python3 - <<PY
import os, subprocess, tempfile, sys, importlib.util
spec = importlib.util.spec_from_file_location("s", "${STATUS}")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

tmp = tempfile.mkdtemp()
def run(*args, cwd=tmp):
    return subprocess.check_output(list(args), cwd=cwd, text=True).strip()

run("git", "init", "-q")
run("git", "config", "user.email", "t@example.com")
run("git", "config", "user.name", "t")
# Empty initial commit (--allow-empty so we can attach the test subject to a real commit)
subprocess.check_call(["git", "-C", tmp, "commit", "--allow-empty",
                       "-m", """${subject}\n\n${body}""".strip()],
                      stdout=subprocess.DEVNULL)

os.chdir(tmp)
merges = m.load_pr_merges_from_git(7)
for label, info in sorted(merges.items()):
    print(f"{label} #{info['pr']}")
PY
}

@test "FIX-107: squash subject 'loop cycle LABEL (#N)' (space format) is parsed" {
  run parse_one "loop cycle 20260523-111800-41380 (#160)"
  [ "$status" -eq 0 ]
  [ "$output" = "20260523-111800-41380 #160" ]
}

@test "FIX-107: squash subject with no body still parses PR # and label" {
  run parse_one "loop cycle 20260523-073139-3959 (#154)"
  [ "$status" -eq 0 ]
  [ "$output" = "20260523-073139-3959 #154" ]
}

@test "FIX-107: legacy 'Merge pull request #N from .../loop/cycle-LABEL' still parses" {
  run parse_one "Merge pull request #134 from seanyao/loop/cycle-20260522-141800-77507"
  [ "$status" -eq 0 ]
  [ "$output" = "20260522-141800-77507 #134" ]
}

@test "FIX-107: subject without any cycle marker is ignored" {
  run parse_one "docs: typo fix"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "FIX-107: story IDs from body are still collected" {
  local pyfile
  pyfile=$(mktemp)
  cat > "$pyfile" <<PY
import os, subprocess, tempfile, importlib.util
spec = importlib.util.spec_from_file_location("s", "${STATUS}")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tmp = tempfile.mkdtemp()
subprocess.check_call(["git", "init", "-q", tmp])
subprocess.check_call(["git", "-C", tmp, "config", "user.email", "t@example.com"])
subprocess.check_call(["git", "-C", tmp, "config", "user.name", "t"])
subprocess.check_call(["git", "-C", tmp, "commit", "--allow-empty",
    "-m", "loop cycle 20260523-111800-41380 (#160)\n\n* tcr: US-VIEW-013 snapshot\n"],
    stdout=subprocess.DEVNULL)
os.chdir(tmp)
merges = m.load_pr_merges_from_git(7)
info = merges["20260523-111800-41380"]
print("US-VIEW-013" in info["stories"], info["pr"])
PY
  run python3 "$pyfile"
  rm -f "$pyfile"
  [ "$status" -eq 0 ]
  [[ "$output" == *"True 160"* ]]
}
