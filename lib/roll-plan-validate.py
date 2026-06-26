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
    factsHash: sha256:<64 lowercase hex chars>
    file_operations:
      - path: .roll/init-diagnosis.yaml | .roll/onboard-plan.yaml
        operation: write
        idempotent: true
    merge_intents:
      - target: str
        owner: roll-init-apply
        strategy: str
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

US-ONBOARD-016 — Phase 2 analysis sections (all OPTIONAL, pure-incremental,
backward compatible; an old plan that omits them still validates). When
present, each is validated for structure:

    domain_model:
      bounded_contexts:
        - name: str
          aggregates: [str]
          ubiquitous_language: [str]   # or [{term, definition}]
    tech_analysis:
      stack: [str]
      dependencies: [str]
      architecture_notes: [str]
      risks:
        - description: str
          severity: LOW | MEDIUM | HIGH   # optional
          evidence: detected | inferred   # optional
    test_assessment:
      current_layers:     [<claim>]
      gaps:               [<claim>]
      recommended_actions:[<claim>]

ANTI-HALLUCINATION HARD CONSTRAINT (the heart of US-ONBOARD-016):
Every test_assessment claim MUST be a mapping carrying an `evidence` key whose
value is exactly `detected` or `inferred`. A schema validator cannot re-run the
filesystem scan, so the data contract is the lever: free-floating untagged
strings (e.g. a hallucinated "needs more E2E tests") are REJECTED. When a scan
finds nothing the skill must still emit a tagged claim such as
`{claim: "none detected", evidence: detected}` — never invent filler. A scan
that ran and returned zero matches is a genuine detection, so "none detected"
carries `evidence: detected` (not a third enum value).
"""

from __future__ import annotations

import sys
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path, PurePosixPath

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
VALID_FACTS_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
AGENT_WRITABLE_OUTPUTS = {".roll/init-diagnosis.yaml", ".roll/onboard-plan.yaml"}
SHELL_COMMAND_KEYS = {"cmd", "command", "commands", "exec", "run", "script", "shell", "shell_commands"}
VALID_MERGE_INTENT_TARGETS = {
    "agent_routes",
    "backlog",
    "briefs",
    "claude_conventions",
    "domain",
    "features",
    "gitignore",
    "phase2_markdown",
    "roll_conventions",
    "sync_targets",
}

# US-ONBOARD-016: anti-hallucination evidence tags. Every test_assessment claim
# must carry one of these; risks[].evidence (when present) uses the same enum.
VALID_EVIDENCE = {"detected", "inferred"}
# test_assessment buckets whose entries are evidence-tagged claims.
TEST_ASSESSMENT_CLAIM_KEYS = ("current_layers", "gaps", "recommended_actions")
# Optional severity enum for tech_analysis.risks[].severity.
VALID_RISK_SEVERITY = {"LOW", "MEDIUM", "HIGH"}


def err(msg_en: str, msg_zh: str = "") -> None:
    """Print bilingual error to stderr."""
    print(f"[plan-validate] {msg_en}", file=sys.stderr)
    if msg_zh:
        print(f"[plan-validate] {msg_zh}", file=sys.stderr)


def validate_required_top_level(plan: dict) -> list[str]:
    """Return list of missing/invalid top-level fields."""
    errors = []
    required = [
        "version",
        "generated_at",
        "factsHash",
        "file_operations",
        "merge_intents",
        "project_understanding",
        "scope",
        "privacy",
    ]
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


def validate_facts_hash_value(value, where: str) -> list[str]:
    if not isinstance(value, str):
        return [f"{where} must be a string"]
    if not VALID_FACTS_HASH_RE.match(value):
        return [f"{where} must match sha256:<64 lowercase hex chars>"]
    return []


def validate_shell_command_keys(value, where: str = "$") -> list[str]:
    """Reject arbitrary shell-command fields anywhere in the agent-authored plan."""
    errors: list[str] = []
    if isinstance(value, list):
        for i, item in enumerate(value):
            errors += validate_shell_command_keys(item, f"{where}[{i}]")
        return errors
    if not isinstance(value, dict):
        return errors
    for key, item in value.items():
        child = f"{where}.{key}"
        if key in SHELL_COMMAND_KEYS:
            errors.append(f"{child} is not allowed in onboard artifacts")
        errors += validate_shell_command_keys(item, child)
    return errors


def validate_file_operations(plan: dict) -> list[str]:
    errors: list[str] = []
    operations = plan.get("file_operations")
    if not isinstance(operations, list):
        return ["file_operations must be a list"]
    seen: set[str] = set()
    for i, op in enumerate(operations):
        where = f"file_operations[{i}]"
        if not isinstance(op, dict):
            errors.append(f"{where} must be a mapping")
            continue
        path = op.get("path")
        if not isinstance(path, str):
            errors.append(f"{where}.path must be a string")
        else:
            parts = PurePosixPath(path).parts
            normalized = PurePosixPath(path).as_posix()
            if path.startswith("/") or "\\" in path or ".." in parts or normalized != path:
                errors.append(f"{where}.path must be a normalized relative project path without traversal")
            if path not in AGENT_WRITABLE_OUTPUTS:
                errors.append(f"{where}.path '{path}' is outside the agent writable outputs")
            elif path in seen:
                errors.append(f"{where}.path '{path}' must not be duplicated")
            else:
                seen.add(path)
        if op.get("operation") != "write":
            errors.append(f"{where}.operation must be write")
        if op.get("idempotent") is not True:
            errors.append(f"{where}.idempotent must be true")
    for expected in sorted(AGENT_WRITABLE_OUTPUTS):
        if expected not in seen:
            errors.append(f"file_operations must include {expected}")
    return errors


def validate_merge_intents(plan: dict) -> list[str]:
    errors: list[str] = []
    intents = plan.get("merge_intents")
    if not isinstance(intents, list):
        return ["merge_intents must be a list"]
    for i, intent in enumerate(intents):
        where = f"merge_intents[{i}]"
        if not isinstance(intent, dict):
            errors.append(f"{where} must be a mapping")
            continue
        if isinstance(intent.get("path"), str):
            errors.append(f"{where} must describe a target, not a file path")
        if intent.get("owner") != "roll-init-apply":
            errors.append(f"{where}.owner must be roll-init-apply")
        target = intent.get("target")
        if not isinstance(target, str) or target not in VALID_MERGE_INTENT_TARGETS:
            errors.append(
                f"{where}.target must be one of {sorted(VALID_MERGE_INTENT_TARGETS)}"
            )
        strategy = intent.get("strategy")
        if not isinstance(strategy, str) or strategy.strip() == "":
            errors.append(f"{where}.strategy must be a non-empty string")
    return errors


def validate_diagnosis_pair(plan: dict, plan_path: Path) -> list[str]:
    errors = validate_facts_hash_value(plan.get("factsHash"), "factsHash")
    diagnosis_path = plan_path.parent / "init-diagnosis.yaml"
    if not diagnosis_path.is_file():
        return errors + [
            "missing required paired artifact: .roll/init-diagnosis.yaml"
        ]
    try:
        with diagnosis_path.open("r", encoding="utf-8") as f:
            diagnosis = yaml.safe_load(f)
    except (yaml.YAMLError, OSError) as e:
        return errors + [f"failed to parse paired .roll/init-diagnosis.yaml: {e}"]
    if not isinstance(diagnosis, dict):
        return errors + [".roll/init-diagnosis.yaml must be a top-level mapping"]
    errors += validate_facts_hash_value(diagnosis.get("factsHash"), "init-diagnosis.factsHash")
    if errors:
        return errors
    if diagnosis.get("factsHash") != plan.get("factsHash"):
        errors.append("plan factsHash must match .roll/init-diagnosis.yaml factsHash")
    return errors


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


def validate_domain_model(plan: dict) -> list[str]:
    """US-ONBOARD-016: validate the optional domain_model section.

    Absent → no errors (pure-incremental). When present it must be a mapping
    with a bounded_contexts list; each context is a mapping with a name and
    list-typed aggregates / ubiquitous_language.
    """
    errors: list[str] = []
    if "domain_model" not in plan:
        return errors
    dm = plan.get("domain_model")
    if not isinstance(dm, dict):
        return ["domain_model must be a mapping"]
    contexts = dm.get("bounded_contexts")
    if contexts is None:
        return ["domain_model.bounded_contexts missing"]
    if not isinstance(contexts, list):
        return ["domain_model.bounded_contexts must be a list"]
    for i, ctx in enumerate(contexts):
        where = f"domain_model.bounded_contexts[{i}]"
        if not isinstance(ctx, dict):
            errors.append(f"{where} must be a mapping")
            continue
        if not ctx.get("name"):
            errors.append(f"{where}.name missing or empty")
        for list_key in ("aggregates", "ubiquitous_language"):
            if list_key in ctx and not isinstance(ctx[list_key], list):
                errors.append(f"{where}.{list_key} must be a list")
    return errors


def _validate_evidence_value(value, where: str) -> list[str]:
    """Shared check: a value must be exactly one of VALID_EVIDENCE."""
    if value is None:
        return [f"{where}.evidence missing (must be one of {sorted(VALID_EVIDENCE)})"]
    if value not in VALID_EVIDENCE:
        return [
            f"{where}.evidence='{value}' invalid "
            f"(must be one of {sorted(VALID_EVIDENCE)})"
        ]
    return []


def validate_tech_analysis(plan: dict) -> list[str]:
    """US-ONBOARD-016: validate the optional tech_analysis section.

    Absent → no errors. When present: stack / dependencies / architecture_notes
    (if given) must be lists; risks (if given) must be a list of mappings each
    with a description, an optional severity in VALID_RISK_SEVERITY, and an
    optional evidence tag in VALID_EVIDENCE.
    """
    errors: list[str] = []
    if "tech_analysis" not in plan:
        return errors
    ta = plan.get("tech_analysis")
    if not isinstance(ta, dict):
        return ["tech_analysis must be a mapping"]
    for list_key in ("stack", "dependencies", "architecture_notes"):
        if list_key in ta and not isinstance(ta[list_key], list):
            errors.append(f"tech_analysis.{list_key} must be a list")
    if "risks" in ta:
        risks = ta["risks"]
        if not isinstance(risks, list):
            errors.append("tech_analysis.risks must be a list")
        else:
            for i, risk in enumerate(risks):
                where = f"tech_analysis.risks[{i}]"
                if not isinstance(risk, dict):
                    errors.append(f"{where} must be a mapping")
                    continue
                if not risk.get("description"):
                    errors.append(f"{where}.description missing or empty")
                sev = risk.get("severity")
                if sev is not None and sev not in VALID_RISK_SEVERITY:
                    errors.append(
                        f"{where}.severity='{sev}' invalid "
                        f"(must be one of {sorted(VALID_RISK_SEVERITY)})"
                    )
                if "evidence" in risk:
                    errors += _validate_evidence_value(risk["evidence"], where)
    return errors


def validate_test_assessment(plan: dict) -> list[str]:
    """US-ONBOARD-016 anti-hallucination HARD constraint.

    Absent → no errors. When present, every entry in current_layers / gaps /
    recommended_actions MUST be a mapping carrying an `evidence` tag of exactly
    `detected` or `inferred`. This is the mechanical lever: untagged free-text
    claims (hallucinated filler) are rejected. An empty bucket is allowed — that
    is how "the section ran but had nothing in this dimension" is expressed; the
    skill represents a zero-result scan as a tagged `{claim: "none detected",
    evidence: detected}` entry rather than inventing a recommendation.
    """
    errors: list[str] = []
    if "test_assessment" not in plan:
        return errors
    ta = plan.get("test_assessment")
    if not isinstance(ta, dict):
        return ["test_assessment must be a mapping"]
    for key in TEST_ASSESSMENT_CLAIM_KEYS:
        if key not in ta:
            continue
        claims = ta[key]
        if not isinstance(claims, list):
            errors.append(f"test_assessment.{key} must be a list")
            continue
        for i, claim in enumerate(claims):
            where = f"test_assessment.{key}[{i}]"
            if not isinstance(claim, dict):
                errors.append(
                    f"{where} must be a mapping carrying an 'evidence' tag "
                    f"(got {type(claim).__name__}); untagged claims are rejected "
                    f"to block unverifiable filler"
                )
                continue
            errors += _validate_evidence_value(claim.get("evidence"), where)
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
    schema_errors += validate_diagnosis_pair(plan, path)
    schema_errors += validate_shell_command_keys(plan)
    schema_errors += validate_file_operations(plan)
    schema_errors += validate_merge_intents(plan)
    schema_errors += validate_project_understanding(plan)
    schema_errors += validate_scope(plan)
    schema_errors += validate_privacy(plan)
    # US-ONBOARD-016: optional Phase 2 analysis sections (validated only when
    # present so old plans stay compatible).
    schema_errors += validate_domain_model(plan)
    schema_errors += validate_tech_analysis(plan)
    schema_errors += validate_test_assessment(plan)

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
