# Roll Skill Selection Guide

Quickly select the right skill or tool.

## Core Skills

| User Intent | Skill | Description |
|---------|-----------|------|
| **"Not sure how to do it"** / **"There are several options"** | `roll-design` | Explore solutions, compare options, human decision-making |
| **"Help me build a..."** / **"Implement US-001"** / **"Fix FIX-001"** | `roll-build` | Universal entry: US-XXX story mode, FIX-XXX fix mode, or free-text fly mode — all in one skill |
| **"This logic is critical"** / **"Involves payment"** | `roll-spar` | Adversarial TDD, activate for high-risk scenarios |
| **"Fix a bug"** / **"Change some copy"** | `roll-fix` | Quick fix, no full workflow |
| **"Plan requirements"** / **"Split into stories"** | `roll-design` | Plan only, no implementation, outputs BACKLOG.md |
| **"Run several Actions in parallel"** | `roll-build` | Auto-determines parallelism after splitting Actions |
| **"Check production status"** | `roll-sentinel` | Production patrol, regression testing |
| **"Debug this page"** | `roll-debug` | Deep diagnosis, collect logs/network/DOM |
| **"Research this topic"** | `roll-research` | HV analysis deep research, outputs PDF report |

## Support Skills

| Scenario | Skill | Trigger Timing |
|------|-------|---------|
| Code self-review | `roll-.review` | Before Commit, or manually triggered |
| Generate Changelog | `roll-.changelog` | Auto-triggered after successful Deploy |
| QA test reference | `roll-.qa` | Referenced when writing tests |
| Intent clarification | `roll-.echo` | Auto-activates when user input is vague or unclear |

## Quick Decision Tree

```
User Input
    |
+----------------------+
| "Unsure about        |
|  the approach?"      |--> roll-design
+----------------------+
    | No
+----------------------+
| "One-sentence        |
|  request?"           |--> roll-build (fly mode)
+----------------------+
    | No
+----------------------+
| "Has a US-XXX ID?"   |--> roll-build (story mode)
+----------------------+
    | No
+----------------------+
| "Has a FIX-XXX ID?"  |--> roll-fix
+----------------------+
    | No
+----------------------+
| "Fix a bug?"         |--> roll-fix
+----------------------+
    | No
+----------------------+
| "Plan/split?"        |--> roll-design
+----------------------+
    | No
+----------------------+
| "High-risk logic?"   |--> roll-spar
+----------------------+
    | No
  Manual judgment
```

## Auto-Trigger Keywords

| Skill | Trigger Keywords |
|-------|-----------|
| `roll-design` | "discuss", "compare options", "how to choose", "trade-offs", "not sure what to use", "design", "plan", "split", "write stories", "requirements analysis" / 讨论、比较方案、怎么选、权衡、不确定用哪个、设计、规划、拆分、写故事、需求分析 |
| `roll-build` | "help me build", "add a feature", "change this", "refactor", "implement US-", "do this story", "complete Action", "parallel", "develop simultaneously" / 帮我做、加个功能、改一下、重构、实现 US-、做这个 story、做这个需求 |
| `roll-fix` | "fix bug", "change copy", "adjust color", "error", "FIX-", "BUG-" / 修个 bug、改文案、调颜色、报错了、修复 |
| `roll-spar` | "adversarial", "attack-defense", "high-risk", "critical logic", "payment", "permissions", "security" / 对抗式、攻防、高风险、核心逻辑、支付、权限、安全 |
| `roll-sentinel` | "patrol", "check production", "regression test" / 巡检、检查生产环境、回归测试 |
| `roll-debug` | "debug", "diagnose", "page has issues", "black-box analysis" / 调试、诊断、页面有问题、排查 |
| `roll-research` | "deep research", "research this", "competitive analysis", "HV analysis", "deep dive" / 深度调研、研究一下、竞品分析、HV 分析、深入了解 |
