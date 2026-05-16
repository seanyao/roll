#!/usr/bin/env python3
"""
loop-fmt.py — 3-tier stream-json → tmux formatter for roll loop.

Tier 3 (suppressed): init, thinking, Read/Glob/Grep, non-error results, plain Bash
Tier 2 (muted):      Edit/Write → ✏ path
Tier 1 (signal):     tcr commit, story skill, peer verdict, ci gate, pr merge, errors
"""
import sys
import json
import re
from datetime import datetime, timezone

DARK_GRAY = "\033[90m"
CYAN      = "\033[36m"
WHITE     = "\033[97m"
GREEN     = "\033[32m"
RED       = "\033[31m"
RESET     = "\033[0m"

SUPPRESS_TOOLS = {"Read", "Glob", "Grep", "ReadMcpResourceTool", "ListMcpResourcesTool",
                  "WebFetch", "WebSearch", "TaskCreate", "TaskGet", "TaskList",
                  "TaskUpdate", "TaskOutput", "TaskStop"}

def now_hms():
    return datetime.now(timezone.utc).strftime("%H:%M:%S")

def trunc(s, n=60):
    s = str(s).replace("\n", " ").strip()
    return s[:n] + "…" if len(s) > n else s

def step(category, label, detail="", ok=True):
    cat_color = CYAN
    label_color = GREEN if ok and category in ("ci", "pr") else (RED if not ok else WHITE)
    arrow = f"{DARK_GRAY}→{RESET}"
    cat   = f"  {cat_color}{category:<6}{RESET}"
    lbl   = f"  {label_color}{label:<14}{RESET}"
    det   = f"  {DARK_GRAY}{detail}{RESET}" if detail else ""
    return f"{arrow}{cat}{lbl}{det}"

def stamp(text, muted=False):
    ts = f"{DARK_GRAY}{now_hms()}{RESET}"
    body = f"{DARK_GRAY}{text}{RESET}" if muted else text
    return f"{ts}  {body}"

class LoopFmt:
    def __init__(self):
        self.last_bash_cmd = ""
        self.tcr_count = 0
        self.last_test_count = None
        self.cycle_num = None
        self.pending_commit = False
        self.pending_pr = False
        self.pending_ci = False

    def _extract_cycle_num(self, text):
        m = re.search(r'cycle[#\s]+(\d+)', text, re.IGNORECASE)
        return m.group(1) if m else "?"

    def process(self, line):
        line = line.rstrip()
        if not line:
            return

        # Plain text passthrough
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            self._handle_plain(line)
            return

        etype = ev.get("type", "")
        if etype == "system":
            return  # Tier 3: suppress all system events
        if etype == "assistant":
            self._handle_assistant(ev)
        elif etype == "user":
            self._handle_user(ev)
        elif etype == "result":
            self._handle_result(ev)
        # All other types: suppress

    def _handle_plain(self, line):
        # [loop] cycle N: ... → Tier 1 stamp
        m = re.search(r'\[loop\]\s+cycle\s+(\d+)[:\s]', line)
        if m:
            self.cycle_num = m.group(1)
            self.tcr_count = 0
            print(stamp(f"cycle #{self.cycle_num} — picking story"))
            return
        # Other plain text: suppress

    def _handle_assistant(self, ev):
        msg = ev.get("message", {})
        for blk in msg.get("content", []):
            btype = blk.get("type", "")
            if btype == "thinking":
                return  # Tier 3
            elif btype == "text":
                self._handle_text(blk.get("text", ""))
            elif btype == "tool_use":
                self._handle_tool_use(blk)

    def _handle_text(self, text):
        text = text.strip()
        if not text:
            return
        # Peer verdict detection
        for verdict in ("AGREE", "REFINE", "OBJECT", "ESCALATE"):
            if verdict in text:
                m = re.search(r'round\s+(\d+)[/\\](\d+)', text, re.IGNORECASE)
                round_str = f"round {m.group(1)}/{m.group(2)}" if m else "round ?"
                # agent names — look for common patterns
                agents = "claude → peer"
                m2 = re.search(r'(\w+)\s*→\s*(\w+)', text)
                if m2:
                    agents = f"{m2.group(1)} → {m2.group(2)}"
                print(step("peer", agents, f"{round_str} · {verdict}"))
                return
        # All other text: Tier 3, suppress

    def _handle_tool_use(self, blk):
        name = blk.get("name", "")
        inp  = blk.get("input", {})

        if name in SUPPRESS_TOOLS:
            return  # Tier 3

        if name in ("Edit", "Write"):
            path = inp.get("file_path") or inp.get("path", "")
            print(f"  {DARK_GRAY}✏ {path}{RESET}")
            return  # Tier 2

        if name == "Bash":
            cmd = inp.get("command", "")
            first_line = next((l.strip() for l in cmd.splitlines() if l.strip()), cmd)
            self.last_bash_cmd = first_line
            if re.search(r'git commit.*tcr:', cmd):
                self.pending_commit = True
            elif re.search(r'gh pr (create|merge)', cmd):
                self.pending_pr = True
            elif re.search(r'(roll ci|npm run ci|ci:local)', cmd):
                self.pending_ci = True
            return  # Wait for result

        if name == "Skill":
            skill = inp.get("skill", "")
            args  = inp.get("args", "").strip()
            if skill in ("roll-build", "roll-fix"):
                us_id = args.split()[0] if args else "?"
                print()
                print(stamp(f"cycle #{self.cycle_num or '?'} — picking story"))
                print(step("story", us_id, trunc(args, 60)))
            return

        # All other tools (Agent, ToolSearch, etc.): suppress

    def _handle_user(self, ev):
        msg = ev.get("message", {})
        for blk in msg.get("content", []):
            if blk.get("type") != "tool_result":
                continue
            is_err  = blk.get("is_error", False)
            content = blk.get("content", "")
            text    = self._extract_text(content)

            # Scan for test count (bats ok N pattern)
            m = re.search(r'\bok\s+(\d+)', text)
            if m:
                self.last_test_count = int(m.group(1))

            if is_err:
                tool_name = "tool"
                lines = [l for l in text.splitlines() if l.strip()][:3]
                detail = " | ".join(lines)
                print(step("error", tool_name, trunc(detail, 80), ok=False))
                self.pending_commit = self.pending_pr = self.pending_ci = False
                return

            if self.pending_commit:
                self.pending_commit = False
                # Extract hash and message from git commit output: [branch hash] msg
                m = re.search(r'\[[\w/\-]+ ([0-9a-f]{7,})\]\s*tcr:\s*(.+)', text)
                if m:
                    commit_hash = m.group(1)[:7]
                    commit_msg  = m.group(2).strip()
                    self.tcr_count += 1
                    test_part = f" · {self.last_test_count} tests" if self.last_test_count else ""
                    print(step("tcr", commit_hash, f"{commit_msg}{test_part}"))
                return

            if self.pending_pr:
                self.pending_pr = False
                m = re.search(r'#(\d+)', text)
                if m:
                    pr_num = f"#{m.group(1)}"
                    branch = re.search(r'loop/[\w\-]+', self.last_bash_cmd)
                    branch_str = branch.group(0) if branch else ""
                    detail = f"auto-merged · {branch_str}" if branch_str else "auto-merged"
                    print(step("pr", pr_num, detail, ok=True))
                return

            if self.pending_ci:
                self.pending_ci = False
                has_green = re.search(r'(green|pass|success|all tests)', text, re.IGNORECASE)
                has_red   = re.search(r'(red|fail|error)', text, re.IGNORECASE)
                m_dur  = re.search(r'(\d+(?:\.\d+)?)\s*s\b', text)
                m_test = re.search(r'(\d+)\s+tests?', text)
                dur_str  = f"{m_dur.group(1)}s" if m_dur else ""
                test_str = f"{m_test.group(1)} tests" if m_test else (f"{self.last_test_count} tests" if self.last_test_count else "")
                detail   = " · ".join(filter(None, [dur_str, test_str]))
                if has_green and not has_red:
                    print(step("ci", "green", detail, ok=True))
                else:
                    print(step("ci", "red", detail, ok=False))
                return

            # Non-matching result: suppress (Tier 3)

    def _extract_text(self, content):
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    parts.append(c.get("text", ""))
            return "\n".join(parts)
        return str(content) if content else ""

    def _handle_result(self, ev):
        dur_ms   = ev.get("duration_ms", 0)
        cost_usd = ev.get("total_cost_usd", 0)
        dur_s    = dur_ms / 1000
        cost_str = f"${cost_usd:.2f}" if cost_usd else ""
        tcr_str  = f"{self.tcr_count} tcr" if self.tcr_count else ""
        parts    = [p for p in [tcr_str, f"{dur_s:.0f}s", cost_str] if p]
        detail   = " · ".join(parts)
        subtype  = ev.get("subtype", "")
        if subtype == "error_max_turns":
            print(step("error", "max-turns", f"{dur_s:.0f}s", ok=False))
        else:
            cycle_str = f"cycle #{self.cycle_num}" if self.cycle_num else "cycle done"
            print(stamp(f"{cycle_str} — done · {detail}" if detail else f"{cycle_str} — done", muted=True))


def main():
    fmt = LoopFmt()
    for line in sys.stdin:
        fmt.process(line)
        sys.stdout.flush()

if __name__ == "__main__":
    main()
