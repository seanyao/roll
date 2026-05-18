#!/usr/bin/env python3
"""
US-ONBOARD-007: onboard-plan.yaml validator.

Validates that a plan file produced by $roll-onboard is structurally complete,
fresh (generated_at within 24h), and version-compatible with the consuming
bin/roll. Called by `roll init --apply` before any side effects.

Usage:
    python3 roll-plan-validate.py <path-to-plan.yaml>

Exit codes:
    0   plan is valid
    1   schema / required field error
    2   plan is stale (generated_at > 24h)
    3   plan version not supported
    4   plan file unreadable / not YAML

Error messages are written to stderr in both English and Chinese.

Schema (v1):
    version: 1
    generated_at: ISO 8601 timestamp (UTC or with tz offset)
    project_understanding:
      type: backend-service | frontend-only | fullstack | cli
      description: str
      domains: [str]
      key_modules: [str]
    scope:
      approved: [str]  # subset of {backlog, features, domain, briefs}
      declined: [str]
    include_existing: [str]
    privacy:
      gitignore_dot_roll: bool
    sync_targets: [str]
    enable_loop: bool
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import yaml  # PyYAML
except ImportError:
    print(
        "[plan-validate] PyYAML not installed. Install with: pip install pyyaml\n"
        "[plan-validate] PyYAML 未安装，请运行: pip install pyyaml",
        file=sys.stderr,
    )
    sys.exit(4)


SUPPORTED_VERSIONS = {1}
MAX_AGE_HOURS = 24
VALID_PROJECT_TYPES = {"backend-service", "frontend-only", "fullstack", "cli"}
VALID_SCOPE_ITEMS = {"backlog", "features", "domain", "briefs"}


def err(msg_en: str, msg_zh: str = "") -> None:
    """Print bilingual error to stderr."""
    print(f"[plan-validate] {msg_en}", file=sys.stderr)
    if msg_zh:
        print(f"[plan-validate] {msg_zh}", file=sys.stderr)


def validate_required_top_level(plan: dict) -> list[str]:
    """Return list of missing/invalid top-level fields."""
    errors = []
    required = ["version", "generated_at", "project_understanding", "scope", "privacy"]
    for key in required:
        if key not in plan:
            errors.append(f"missing required field: {key}")
    return errors


def validate_version(plan: dict) -> list[str]:
    v = plan.get("version")
    if not isinstance(v, int):
        return [f"version must be int, got {type(v).__name__}"]
    if v not in SUPPORTED_VERSIONS:
        return [f"version {v} not supported (supported: {sorted(SUPPORTED_VERSIONS)})"]
    return []


def validate_freshness(plan: dict) -> tuple[list[str], bool]:
    """Returns (errors, is_stale). Stale uses exit code 2."""
    raw = plan.get("generated_at")
    if not raw:
        return ["generated_at missing"], False
    try:
        if isinstance(raw, datetime):
            ts = raw
        else:
            ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (ValueError, TypeError) as e:
        return [f"generated_at not a valid ISO 8601 timestamp: {e}"], False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    age = now - ts
    if age > timedelta(hours=MAX_AGE_HOURS):
        return [
            f"plan is stale: generated {age.total_seconds() / 3600:.1f}h ago "
            f"(max allowed: {MAX_AGE_HOURS}h)"
        ], True
    if age < timedelta(seconds=-300):
        # Plan in future >5 min — clock skew or fabricated timestamp
        return [
            f"plan timestamp is in the future (clock skew?): generated_at={ts.isoformat()}"
        ], False
    return [], False


def validate_project_understanding(plan: dict) -> list[str]:
    errors = []
    pu = plan.get("project_understanding")
    if not isinstance(pu, dict):
        return ["project_understanding must be a mapping"]
    t = pu.get("type")
    if t is None:
        errors.append("project_understanding.type missing")
    elif t not in VALID_PROJECT_TYPES:
        errors.append(
            f"project_understanding.type='{t}' not in {sorted(VALID_PROJECT_TYPES)}"
        )
    if "description" not in pu:
        errors.append("project_understanding.description missing")
    return errors


def validate_scope(plan: dict) -> list[str]:
    errors = []
    scope = plan.get("scope")
    if not isinstance(scope, dict):
        return ["scope must be a mapping"]
    approved = scope.get("approved", [])
    if not isinstance(approved, list):
        errors.append("scope.approved must be a list")
    else:
        for item in approved:
            if item not in VALID_SCOPE_ITEMS:
                errors.append(
                    f"scope.approved contains unknown item '{item}' "
                    f"(valid: {sorted(VALID_SCOPE_ITEMS)})"
                )
    return errors


def validate_privacy(plan: dict) -> list[str]:
    errors = []
    privacy = plan.get("privacy")
    if not isinstance(privacy, dict):
        return ["privacy must be a mapping"]
    g = privacy.get("gitignore_dot_roll")
    if not isinstance(g, bool):
        errors.append(
            f"privacy.gitignore_dot_roll must be bool, got {type(g).__name__}"
        )
    return errors


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        err("usage: roll-plan-validate.py <plan.yaml>", "用法: roll-plan-validate.py <plan.yaml>")
        return 4

    path = Path(argv[1])
    if not path.is_file():
        err(f"plan file not found: {path}", f"未找到 plan 文件：{path}")
        return 4

    try:
        with path.open("r", encoding="utf-8") as f:
            plan = yaml.safe_load(f)
    except (yaml.YAMLError, OSError) as e:
        err(f"failed to parse plan as YAML: {e}", "无法解析 plan YAML")
        return 4

    if not isinstance(plan, dict):
        err("plan must be a top-level mapping", "plan 顶层必须是 mapping")
        return 1

    schema_errors: list[str] = []
    schema_errors += validate_required_top_level(plan)
    schema_errors += validate_version(plan)
    schema_errors += validate_project_understanding(plan)
    schema_errors += validate_scope(plan)
    schema_errors += validate_privacy(plan)

    freshness_errors, is_stale = validate_freshness(plan)

    # Version errors take precedence — if version is wrong, the rest of the
    # validation may be unreliable.
    version_errors = [e for e in schema_errors if e.startswith("version")]
    if version_errors:
        for e in version_errors:
            err(e)
        return 3

    if is_stale:
        for e in freshness_errors:
            err(e, "plan 已过期，请重新运行 $roll-onboard 生成新 plan")
        return 2

    all_errors = [e for e in schema_errors if not e.startswith("version")] + [
        e for e in freshness_errors if not is_stale
    ]
    if all_errors:
        for e in all_errors:
            err(e)
        return 1

    # Valid — silent success (bash caller treats exit 0 as OK).
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
