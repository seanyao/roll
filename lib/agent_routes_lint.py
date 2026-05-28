#!/usr/bin/env python3
"""Lint .roll/agent-routes.yaml against schema v1 (US-AGENT-002).

Usage:
  agent_routes_lint.py <path>

Exit 0 when valid, exit 1 with line-numbered errors on stderr otherwise.
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("agent-routes lint: PyYAML not installed", file=sys.stderr)
    sys.exit(2)


VALID_TYPES = {"FIX", "US", "REFACTOR"}
VALID_RISK = {"low", "medium", "high"}


class LintError:
    __slots__ = ("line", "msg")

    def __init__(self, line: int, msg: str) -> None:
        self.line = line
        self.msg = msg

    def __str__(self) -> str:
        # Format: "line N: <message>" — match test regex `line[[:space:]]+[0-9]+`
        if self.line > 0:
            return f"line {self.line}: {self.msg}"
        return self.msg


def _node_line(node) -> int:
    """Return 1-based line number of a ruamel node, or 0 if unavailable."""
    mark = getattr(node, "start_mark", None)
    if mark is None:
        return 0
    return mark.line + 1


def _scan(path: Path) -> list[LintError]:
    """Load and validate the YAML file. Returns a list of LintError."""
    errs: list[LintError] = []

    try:
        text = path.read_text()
    except FileNotFoundError:
        return [LintError(0, f"file not found: {path}")]

    # Use safe loader with composer to get line info per top-level key.
    try:
        # Parse with composer to retain line marks.
        loader = yaml.SafeLoader(text)
        try:
            node = loader.get_single_node()
        finally:
            loader.dispose()
    except yaml.YAMLError as exc:
        line = getattr(getattr(exc, "problem_mark", None), "line", -1)
        return [LintError(line + 1 if line >= 0 else 0, f"YAML parse error: {exc}")]

    if node is None:
        return [LintError(0, "empty YAML document")]

    if not isinstance(node, yaml.MappingNode):
        return [LintError(_node_line(node), "top-level must be a mapping")]

    # Walk top-level fields to capture line numbers.
    top: dict[str, tuple[int, yaml.Node]] = {}
    for key_node, value_node in node.value:
        if isinstance(key_node, yaml.ScalarNode):
            top[key_node.value] = (_node_line(key_node), value_node)

    # --- schema field ---
    if "schema" not in top:
        errs.append(LintError(1, "missing required field `schema`"))
    else:
        schema_line, schema_val = top["schema"]
        if not (isinstance(schema_val, yaml.ScalarNode) and schema_val.value == "v1"):
            errs.append(LintError(schema_line, "field `schema` must be `v1`"))

    # --- agents field ---
    if "agents" not in top:
        errs.append(LintError(1, "missing required field `agents`"))
    else:
        agents_line, agents_val = top["agents"]
        if not isinstance(agents_val, yaml.MappingNode):
            errs.append(LintError(agents_line, "field `agents` must be a mapping"))
        else:
            for agent_key, agent_val in agents_val.value:
                if not isinstance(agent_key, yaml.ScalarNode):
                    continue
                name = agent_key.value
                name_line = _node_line(agent_key)
                _validate_agent(name, name_line, agent_val, errs)

    # --- history (optional) ---
    if "history" in top:
        hist_line, hist_val = top["history"]
        if not isinstance(hist_val, yaml.MappingNode):
            errs.append(LintError(hist_line, "field `history` must be a mapping"))
        else:
            _validate_history(hist_val, errs)

    return errs


def _validate_agent(name: str, name_line: int, node: yaml.Node, errs: list[LintError]) -> None:
    if not isinstance(node, yaml.MappingNode):
        errs.append(LintError(name_line, f"agent `{name}` must be a mapping"))
        return
    fields: dict[str, tuple[int, yaml.Node]] = {}
    for k, v in node.value:
        if isinstance(k, yaml.ScalarNode):
            fields[k.value] = (_node_line(k), v)

    # types
    if "types" not in fields:
        errs.append(LintError(name_line, f"agent `{name}` missing `types`"))
    else:
        tl, tv = fields["types"]
        if not isinstance(tv, yaml.SequenceNode):
            errs.append(LintError(tl, f"agent `{name}`.types must be a list"))
        else:
            for item in tv.value:
                if isinstance(item, yaml.ScalarNode) and item.value not in VALID_TYPES:
                    errs.append(LintError(_node_line(item), f"agent `{name}`.types: invalid value `{item.value}` (expect one of FIX/US/REFACTOR)"))

    # est_min
    if "est_min" not in fields:
        errs.append(LintError(name_line, f"agent `{name}` missing `est_min`"))
    else:
        el, ev = fields["est_min"]
        if not isinstance(ev, yaml.MappingNode):
            errs.append(LintError(el, f"agent `{name}`.est_min must be a mapping {{min, max}}"))
        else:
            est_fields = {k.value: v for k, v in ev.value if isinstance(k, yaml.ScalarNode)}
            if "min" not in est_fields or "max" not in est_fields:
                errs.append(LintError(el, f"agent `{name}`.est_min requires both `min` and `max`"))

    # risk
    if "risk" not in fields:
        errs.append(LintError(name_line, f"agent `{name}` missing `risk`"))
    else:
        rl, rv = fields["risk"]
        if not isinstance(rv, yaml.SequenceNode):
            errs.append(LintError(rl, f"agent `{name}`.risk must be a list"))
        else:
            for item in rv.value:
                if isinstance(item, yaml.ScalarNode) and item.value not in VALID_RISK:
                    errs.append(LintError(_node_line(item), f"agent `{name}`.risk: invalid value `{item.value}` (expect low/medium/high)"))


def _validate_history(node: yaml.MappingNode, errs: list[LintError]) -> None:
    fields = {k.value: (_node_line(k), v) for k, v in node.value if isinstance(k, yaml.ScalarNode)}

    if "window_cycles" in fields:
        wl, wv = fields["window_cycles"]
        if isinstance(wv, yaml.ScalarNode):
            try:
                n = int(wv.value)
                if n < 1:
                    errs.append(LintError(wl, "history.window_cycles must be >= 1"))
            except ValueError:
                errs.append(LintError(wl, "history.window_cycles must be an integer"))

    if "prefer_threshold" in fields:
        pl, pv = fields["prefer_threshold"]
        if isinstance(pv, yaml.ScalarNode):
            try:
                f = float(pv.value)
                if not (0.0 <= f <= 1.0):
                    errs.append(LintError(pl, f"history.prefer_threshold must be in [0.0, 1.0], got {f}"))
            except ValueError:
                errs.append(LintError(pl, "history.prefer_threshold must be a number"))

    if "cold_start_default" in fields:
        cl, cv = fields["cold_start_default"]
        if not isinstance(cv, yaml.ScalarNode):
            errs.append(LintError(cl, "history.cold_start_default must be a string"))


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: agent_routes_lint.py <path>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    errors = _scan(path)
    if not errors:
        return 0
    for err in errors:
        print(str(err), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
