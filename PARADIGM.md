# Cybernetix (CNX)

> AI-Native Development Workflow  
> _Let's roll, no sprints!_

---

## 1. Core Idea: Feedback-Driven Continuous Delivery

The core of CNX is simple: **set a goal → execute → check results → adjust based on feedback**, in a continuous loop.

```
┌──────────────────────────────────────────────────────────┐
│                  Feedback-Driven Loop                     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│   Goal             Sense             Compare              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│   │   BACKLOG   │←─│  Sentinel   │←─│   Diff      │     │
│   │ (desired    │  │ (actual     │  │ (gap        │     │
│   │  state)     │  │  state)     │  │  analysis)  │     │
│   └──────┬──────┘  └─────────────┘  └──────┬──────┘     │
│          │                                  │            │
│          ▼                                  ▼            │
│   ┌─────────────┐                    ┌─────────────┐     │
│   │   Design    │                    │    Fix      │     │
│   │  plan +     │                    │  repair +   │     │
│   │  design     │                    │  improve    │     │
│   └─────────────┘                    └─────────────┘     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Workflow Phases:**

```
Design (discuss + plan) → Build (execute) → Check (patrol) → Fix (repair) → Loop
    $cnx-design          $cnx-story-build   $cnx-sentinel     $cnx-fix-build
```

---

## 2. Practice Layer: Single Agent + Skill Ecosystem

> ⚠️ **Current State**: Proven loop based on a single Agent (Kimi Code CLI)
> 
> Multi-agent coordination is a **future direction**, not yet practiced

### 2.1 Current Practice Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Single Agent + Skill Ecosystem                      │
│                   (currently implemented)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User (human)                                                   │
│      │                                                           │
│      ▼                                                           │
│   ┌─────────────────────────────────────┐                       │
│   │      Kimi Code CLI (Agent)          │                       │
│   │  ┌─────────┐ ┌─────────┐ ┌───────┐ │                       │
│   │  │$cnx-    │ │$story   │ │$sentin│ │                       │
│   │  │ design  │ │-build   │ │el     │ │                       │
│   │  │$project │ │$fix     │ │$bb    │ │                       │
│   │  │ -init   │ │-build   │ │-debug │ │                       │
│   │  │$roll    │ │...      │ │...    │ │                       │
│   │  │ -build  │ │         │ │       │ │                       │
│   │  └─────────┘ └─────────┘ └───────┘ │                       │
│   │            Skill Ecosystem          │                       │
│   └─────────────────────────────────────┘                       │
│      │                                                           │
│      ▼                                                           │
│   OS / Filesystem / Git / Tests / Deploy                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Skill Ecosystem

Skills currently implemented on Kimi Code CLI:

| Skill | Phase | Function | Status |
|-------|-------|----------|--------|
| `$cnx-init` | - | Initialize project | ✅ Implemented |
| `$cnx-design` | DESIGN | Discuss + design + plan Stories | ✅ Implemented |
| `$cnx-story-build` | BUILD | Story delivery (with parallel dispatch) | ✅ Implemented |
| `$cnx-spar` | BUILD | Adversarial TDD: Attacker/Defender collaboration | ✅ Implemented |
| `$cnx-fix-build` | BUILD/FIX | Bug fix | ✅ Implemented |
| `$cnx-roll-build` | DESIGN+BUILD | One-sentence quick implementation | ✅ Implemented |
| `$cnx-sentinel` | CHECK | Scheduled patrol | ✅ Implemented |
| `$cnx-bb-debug` | CHECK | Deep diagnostics | ✅ Implemented |
| `$cnx-bb-analyzer` | CHECK | Diagnostic analysis | ✅ Implemented |
| `$cnx-qa-cover` | Support | Testing standards | ✅ Implemented |
| `$cnx-.code-review` | Support | Pre-commit self-review | ✅ Implemented |
| `$cnx-.echo` | Support | Passive intent clarification | ✅ Implemented |
| `$cnx-research` | RESEARCH | Deep research with HV Analysis + PDF report | ✅ Implemented |

**Tools (environment integration):**

| Tool | Type | Function | Status |
|------|------|----------|--------|
| `$cnx-fetch` | 🕵️ Intel | Web scraping, search, crawling | ✅ Implemented |
| `$cnx-probe` | 🔭 Monitor | Node discovery, health check | ✅ Implemented |

**Proven Loop:**
```bash
# Currently runnable end-to-end flow
$cnx-project-init my-app
$cnx-design "user system"
$cnx-story-build US-001
$cnx-sentinel patrol  # runs automatically
$cnx-fix-build FIX-001
# ... continuous loop
```

---

## 3. Current Workflow

```
        ┌──────────┐
        │ DESIGN   │  $cnx-design
        │ discuss  │
        │ + plan   │
        └────┬─────┘
             │
             ▼
        ┌──────────┐
        │  BUILD   │  $cnx-story-build / $cnx-fix-build
        │ execute  │
        └────┬─────┘
             │
             ▼
        ┌──────────┐
        │  CHECK   │  $cnx-sentinel / $cnx-bb-debug
        │ patrol   │  Sentinel: GitHub Actions automated
        └────┬─────┘
             │
             ▼
        ┌──────────┐
        │   FIX    │  $cnx-fix-build
        │ repair   │
        └────┬─────┘
             │
             └──────── continuous loop
```

---

## 4. Architecture Layer: Decoupling Patterns

### 4.1 Practiced Architecture Patterns

| Pattern | Status | Notes |
|---------|--------|-------|
| **Domain Driven** | ✅ Practiced | `src/domains/` directory structure |
| **EDA** | 🟡 Partial | Event definitions, needs refinement |
| **API/CLI** | ✅ Practiced | Included in project template |
| **Stateless** | ✅ Practiced | Vercel Edge deployment |

### 4.2 Project Structure (Implemented)

```
my-project/  (auto-generated by $cnx-init)
│
├── 📋 BACKLOG.md              # ✅ Task index
├── 🤖 AGENTS.md               # ✅ Constraint definitions
├── 📁 docs/features/          # ✅ Story details & design docs
├── 🔌 api/                    # ✅ API layer
├── 📦 src/domains/            # ✅ Domain decoupling
├── ⚙️ .env.example            # ✅ Service configuration
└── 🧪 tests/                  # ✅ Test structure
```

---

## 5. Status Assessment

| Dimension | Status | Notes |
|-----------|--------|-------|
| Feedback-driven loop | ✅ | Design → Build → Check → Fix |
| Skill ecosystem | ✅ | 14 Skills + 2 Tools |
| Parallel dispatch | ✅ | Built-in Worktree isolation in story-build |
| Verification gate | ✅ | Fresh evidence required before completion |
| Project template | ✅ | $cnx-init |
| Architecture constraints | ✅ | AGENTS.md |
| Automated patrol | ✅ | Sentinel |
| Convention management | ✅ | cybernetix CLI, unified distribution across AI tools |

---

## Summary

Implemented:

- Feedback-driven continuous delivery loop (Design → Build → Check → Fix)
- Standardized, reusable skill ecosystem (14 Skills + 2 Tools)
- Built-in parallel dispatch + Worktree isolation in story-build
- Verification gate: fresh evidence required before completion
- Convention management: unified behavioral conventions across AI tools (`cybernetix` CLI)

---

## References

- **Agents**: Kimi Code CLI, Claude Code, Gemini CLI, Codex, Cursor
