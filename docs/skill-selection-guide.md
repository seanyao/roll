# CNX Skill Selection Guide

Quickly select the right skill or tool.

## Core Skills

| User Intent | Skill | Description |
|---------|-----------|------|
| **"Not sure how to do it"** / **"There are several options"** | `cnx-design` | Explore solutions, compare options, human decision-making |
| **"Help me build a..."** (unclear requirements) | `cnx-roll-build` | One-sentence request, AI auto-clarifies -> plans -> implements |
| **"Implement US-001"** (with a clear story) | `cnx-story-build` | Execute per BACKLOG.md, full delivery |
| **"This logic is critical"** / **"Involves payment"** | `cnx-spar` | Adversarial TDD, activate for high-risk scenarios |
| **"Fix a bug"** / **"Change some copy"** | `cnx-fix-build` | Quick fix, no full workflow |
| **"Plan requirements"** / **"Split into stories"** | `cnx-design` | Plan only, no implementation, outputs BACKLOG.md |
| **"Run several Actions in parallel"** | `cnx-story-build` | Auto-determines parallelism after splitting Actions |
| **"Initialize project"** | `cnx-init` | Create standard directory structure + BACKLOG.md |
| **"Check production status"** | `cnx-sentinel` | Production patrol, regression testing |
| **"Debug this page"** | `cnx-bb-debug` | Deep diagnosis, collect logs/network/DOM |

## Tools

| User Intent | Tool | Decision Logic |
|---------|----------|---------|
| **"Scrape a webpage"** / **"Crawl docs"** | `cnx-fetch` | See fetch method selection below |
| **"Find the Orin machine"** / **"Check nodes"** | `cnx-probe` | `find` -> discover machines / `health` -> health check / `diagnose` -> full diagnosis |

### cnx-fetch Method Selection

| Priority | Method | Condition | Description |
|-------|------|------|------|
| 1 | **Tavily API** | Has `TAVILY_API_KEY` | Best quality, AI-optimized extraction |
| 2 | **LLM Native Fetch** | No Tavily | Use Kimi/Codex/Claude built-in fetch |
| 3 | **Browser Automation** | First two failed | See browser-use selection |

#### browser-use Selection

| Condition | Choice | Command |
|------|------|------|
| Has `BROWSER_USE_API_KEY` | **Cloud** | `Agent(task=...)` |
| `browser-use` installed | **Local** | `Browser(headless=True)` |
| Neither available | **Skip** | Prompt user to configure |

## Support Skills

| Scenario | Skill | Trigger Timing |
|------|-------|---------|
| Celebrate after Build | `cnx-.yeah` 🎉 | Auto-executes after successful Build |
| Code self-review | `cnx-.code-review` | Before Commit, or manually triggered |
| Generate Changelog | `cnx-.changelog` | Auto-triggered after successful Deploy |
| QA test reference | `cnx-.qa-cover` | Referenced when writing tests |

## Quick Decision Tree

```
User Input
    |
+----------------------+
| "Unsure about        |
|  the approach?"      |--> cnx-design
+----------------------+
    | No
+----------------------+
| "One-sentence        |
|  request?"           |--> cnx-roll-build
+----------------------+
    | No
+----------------------+
| "Has a US ID?"       |--> cnx-story-build
+----------------------+
    | No
+----------------------+
| "Fix a bug?"         |--> cnx-fix-build
+----------------------+
    | No
+----------------------+
| "Plan/split?"        |--> cnx-design
+----------------------+
    | No
+----------------------+
| "Scrape a webpage?"  |--> cnx-fetch
+----------------------+
    | No
+----------------------+
| "Find a machine?"    |--> cnx-probe
+----------------------+
    | No
  Manual judgment
```

## Auto-Trigger Keywords

| Skill | Trigger Keywords |
|-------|-----------|
| `cnx-design` | "discuss", "compare options", "how to choose", "trade-offs", "not sure what to use", "design", "plan" |
| `cnx-roll-build` | "help me build", "add a feature", "change this", "refactor" |
| `cnx-story-build` | "implement US-", "do this story", "complete Action" |
| `cnx-fix-build` | "fix bug", "change copy", "adjust color", "error" |
| `cnx-design` | "plan", "split", "write stories", "requirements analysis" |
| `cnx-spar` | "adversarial", "attack-defense", "high-risk", "critical logic", "payment", "permissions", "security" |
| `cnx-story-build` | "parallel", "develop simultaneously", "dispatch", "multi-path" |
| `cnx-fetch` | "scrape", "crawl", "extract webpage", "get content" |
| `cnx-probe` | "find machine", "check node", "check Orin", "health check" |
| `cnx-sentinel` | "patrol", "check production", "regression test" |
| `cnx-bb-debug` | "debug", "diagnose", "page has issues", "black-box analysis" |
