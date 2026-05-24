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
import os
import threading
import time
from datetime import datetime, timezone

_SPIN_ENABLED = os.environ.get("LOOP_FMT_NO_SPIN", "0") != "1"
SPIN_FRAMES   = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

DARK_GRAY = "\033[90m"
CYAN      = "\033[36m"
WHITE     = "\033[97m"
GREEN     = "\033[32m"
RED       = "\033[31m"
YELLOW    = "\033[33m"
RESET     = "\033[0m"


class Spinner:
    """Animated wait indicator for long-running operations.

    In production (LOOP_FMT_NO_SPIN=0): background thread writes frames using \\r.
    In test mode  (LOOP_FMT_NO_SPIN=1): writes a static ⏳ line to stdout instead.
    """
    def __init__(self):
        self._thread  = None
        self._running = False
        self._label   = ""
        self._lock    = threading.Lock()

    @property
    def active(self):
        return self._running

    def start(self, label):
        with self._lock:
            if self._running:
                self._label = label  # update without restart
                return
            self._label   = label
            self._running = True
        if _SPIN_ENABLED:
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
        else:
            sys.stdout.write(f"  {YELLOW}⏳ {label}...{RESET}\n")
            sys.stdout.flush()

    def stop(self):
        with self._lock:
            was_running   = self._running
            self._running = False
        if self._thread:
            self._thread.join(timeout=0.3)
            self._thread = None
        if _SPIN_ENABLED and was_running:
            sys.stdout.write(f"\r{' ' * 60}\r")
            sys.stdout.flush()

    def _run(self):
        i = 0
        while self._running:
            with self._lock:
                label = self._label
            frame = SPIN_FRAMES[i % len(SPIN_FRAMES)]
            sys.stdout.write(f"\r  {YELLOW}{frame} {label}...{RESET}")
            sys.stdout.flush()
            time.sleep(0.12)
            i += 1
        sys.stdout.write(f"\r{' ' * 60}\r")
        sys.stdout.flush()

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
        self.last_bash_cmd   = ""
        self.tcr_count       = 0
        self.last_test_count = None
        self.cycle_num       = None
        self.pending_commit  = False
        self.pending_pr      = False
        self.pending_ci      = False
        self.pending_story   = False
        self.spinner         = Spinner()
        # Accumulate token usage across all assistant turns in the cycle so
        # the trailing result event can emit a 'usage' event carrying the
        # cumulative totals (result.usage only carries the last turn's).
        self._usage_totals   = {
            "input_tokens":          0,
            "output_tokens":         0,
            "cache_creation_tokens": 0,
            "cache_read_tokens":     0,
        }
        self._last_model     = None

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
        # Sum token usage across turns; result.usage only carries the last
        # turn so accumulating here is the only way to get cumulative totals.
        u = msg.get("usage") or {}
        if u:
            self._usage_totals["input_tokens"]          += int(u.get("input_tokens") or 0)
            self._usage_totals["output_tokens"]         += int(u.get("output_tokens") or 0)
            self._usage_totals["cache_creation_tokens"] += int(u.get("cache_creation_input_tokens") or 0)
            self._usage_totals["cache_read_tokens"]     += int(u.get("cache_read_input_tokens") or 0)
        if msg.get("model"):
            self._last_model = msg["model"]
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
                self.spinner.start("merging PR")
            elif re.search(r'(roll ci|npm run ci|_ci_wait|ci:local)', cmd):
                self.pending_ci = True
                self.spinner.start("waiting for CI")
            return  # Wait for result

        if name == "Skill":
            skill = inp.get("skill", "")
            args  = inp.get("args", "").strip()
            if skill in ("roll-build", "roll-fix"):
                us_id = args.split()[0] if args else "?"
                print()
                print(stamp(f"cycle #{self.cycle_num or '?'} — picking story"))
                print(step("story", us_id, trunc(args, 60)))
                self.pending_story = True
                self.spinner.start("executing story")
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

            if self.pending_story:
                self.pending_story = False
                self.spinner.stop()
                return  # story result content suppressed; TCR events showed the work

            if self.pending_pr:
                self.spinner.stop()
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
                self.spinner.stop()
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

        # US-LOOP-004 partial: emit a per-cycle 'usage' event into the
        # durable events.ndjson so dashboards don't have to rely on the
        # cron.log (overwritten every cycle). Skips silently when the
        # required env vars aren't set (e.g. running outside roll loop).
        self._emit_usage_event(ev, dur_ms, cost_usd)

    @staticmethod
    def _price_at_snapshot(model, totals):
        """Resolve (cost_list, currency, prices_version) from the active price snapshot.

        Returns (None, None, None) when model_prices isn't loadable or the snapshot
        has no usable prices — callers still emit the event so token data and
        duration aren't lost. When tokens are all zero, cost_list is None.
        """
        try:
            import importlib.util
            lib_dir = os.path.dirname(os.path.abspath(__file__))
            spec = importlib.util.spec_from_file_location(
                "model_prices", os.path.join(lib_dir, "model_prices.py")
            )
            mp = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mp)
        except Exception:
            return None, None, None
        prices_version = getattr(mp, "VERSION", None)
        has_tokens = any(int(totals.get(k) or 0) > 0 for k in totals)
        if not has_tokens:
            return None, None, prices_version
        try:
            cost = mp.compute_list_cost(
                model,
                input_tokens=int(totals.get("input_tokens") or 0),
                output_tokens=int(totals.get("output_tokens") or 0),
                cache_creation_tokens=int(totals.get("cache_creation_tokens") or 0),
                cache_read_tokens=int(totals.get("cache_read_tokens") or 0),
            )
            currency = mp.currency_for(model) if model else "USD"
        except Exception:
            return None, None, prices_version
        return float(cost), currency, prices_version

    def _emit_usage_event(self, result_ev, dur_ms, cost_usd):
        slug    = os.environ.get("LOOP_PROJECT_SLUG")
        cycle   = os.environ.get("LOOP_CYCLE_ID")
        shared  = os.environ.get("LOOP_SHARED_ROOT") or os.path.expanduser("~/.shared/roll")
        if not (slug and cycle):
            return
        # Use the cumulative totals accumulated across all assistant turns;
        # result.usage is per-turn (last only) so it would under-count badly.
        model = result_ev.get("model") or self._last_model or ""

        # FIX-099: skip writing the usage event when claude returned no real
        # usage data (model empty AND cost/duration both zero). This prevents
        # stale/placeholder values from leaking into the events stream and
        # showing up as "cost=$1.24 dur=372s" in three consecutive cycles when
        # the real cycle had no token data (the default-value fallback).
        # The dashboard can render "n/a" for missing usage rather than false data.
        has_model   = bool(model)
        has_tokens  = any(self._usage_totals[k] > 0 for k in self._usage_totals)
        has_cost    = bool(cost_usd)
        has_dur     = bool(dur_ms)
        if not has_model and not has_tokens and not has_cost and not has_dur:
            return  # nothing real to report — skip rather than persist zeros

        # US-VIEW-014: freeze cost at the current snapshot's list price so a
        # later prices refresh (or roll upgrade) never rewrites history. The
        # dashboard reads cost_list_usd first; only legacy events without it
        # fall back to recomputing and get tagged [legacy].
        # FIX-116: also capture cost_currency so the dashboard shows the
        # correct currency symbol (e.g. $ for USD, ¥ for CNY).
        cost_list_usd, cost_currency, prices_version = self._price_at_snapshot(
            model if has_model else None,
            self._usage_totals,
        )

        payload = {
            "model":                 model if has_model else None,
            "input_tokens":          self._usage_totals["input_tokens"],
            "output_tokens":         self._usage_totals["output_tokens"],
            "cache_creation_tokens": self._usage_totals["cache_creation_tokens"],
            "cache_read_tokens":     self._usage_totals["cache_read_tokens"],
            "cost_reported_usd":     float(cost_usd) if has_cost else None,
            "duration_ms":           int(dur_ms) if has_dur else None,
            "cost_list_usd":         cost_list_usd,
            "cost_currency":         cost_currency,
            "prices_version":        prices_version,
        }
        evfile = os.path.join(shared, "loop", f"events-{slug}.ndjson")
        line = json.dumps({
            "ts":      datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "stage":   "usage",
            "label":   cycle,
            "detail":  payload,
            "outcome": "ok",
        }) + "\n"
        try:
            os.makedirs(os.path.dirname(evfile), exist_ok=True)
            with open(evfile, "a") as f:
                f.write(line)
        except Exception:
            pass  # best-effort; never break tmux output


def _passthrough_main(agent):
    """Transparent forwarding for non-claude agents (pi, deepseek, kimi, …).

    Writes every stdin line to stdout with a HH:MM:SS timestamp prefix so
    tmux shows real-time progress.  Also appends each line as a lightweight
    'usage'-type event to the per-slug events ndjson — token / cost fields
    are set to null (agent-specific parsing is out of scope for this US).
    """
    slug   = os.environ.get("LOOP_PROJECT_SLUG")
    cycle  = os.environ.get("LOOP_CYCLE_ID")
    shared = os.environ.get("LOOP_SHARED_ROOT") or os.path.expanduser("~/.shared/roll")
    evfile = None
    if slug and cycle:
        evfile = os.path.join(shared, "loop", f"events-{slug}.ndjson")
        try:
            os.makedirs(os.path.dirname(evfile), exist_ok=True)
        except Exception:
            evfile = None

    for line in sys.stdin:
        if not line.rstrip():
            continue
        # Timestamp prefix so tmux shows activity (even if agent output has
        # no timestamps of its own).
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        out = f"{DARK_GRAY}{ts}{RESET}  {line.rstrip()}"
        sys.stdout.write(out + "\n")
        sys.stdout.flush()
        # Emit a lightweight usage event so the cycle has *some* event trace
        # (token/cost are null — parsing those is agent-specific and out of
        # scope for the minimal transparent-passthrough US).
        if evfile:
            _emit_passthrough_event(evfile, cycle, agent, line.rstrip())


def _emit_passthrough_event(evfile, cycle, agent, text):
    """Best-effort append a usage-type event to evfile."""
    payload = {
        "model":        agent,
        "input_tokens":  None,
        "output_tokens": None,
        "cost_list_usd": None,
        "duration_ms":   None,
    }
    record = json.dumps({
        "ts":      datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stage":   "usage",
        "label":   cycle,
        "detail":  payload,
        "outcome": "ok",
    }) + "\n"
    try:
        with open(evfile, "a") as f:
            f.write(record)
    except Exception:
        pass


def main():
    agent = os.environ.get("ROLL_LOOP_AGENT", "claude")
    if agent == "claude":
        fmt = LoopFmt()
        for line in sys.stdin:
            fmt.process(line)
            sys.stdout.flush()
    else:
        _passthrough_main(agent)

if __name__ == "__main__":
    main()
