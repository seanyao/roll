---
name: roll-debug
license: MIT
description: Universal web debugger. Mounts a Black Box (BB) diagnostic probe on any page, collects rich diagnostics, analyzes root causes, and suggests fixes. Cleans up after itself.
---

# Roll Debug

Web debugging tool that treats the **Black Box (BB) as a diagnostic probe** — mounted when needed, unmounted when done. Combines diagnostic collection and analysis into a single workflow: **Mount → Collect → Analyze → Unmount**.

## Philosophy

- BB is a **diagnostic probe**, not a product feature. Pages do not need to integrate BB natively.
- For any web diagnosis, **mount BB first** (unless already present).
- The entire lifecycle is **explicit and visible**: you see when BB mounts, when it collects, and when it unmounts.
- A visible **BB button** appears on the page during diagnosis so you always know the probe is active.

## When to Use

- "Debug the page"
- "See what's wrong"
- "Page shows blank"
- "Feature not working"
- User uploads a diagnostic file (`diagnostics-*.json`, `bb-report.json`)
- "Analyze BB data", "look at the diagnostic file"
- Any scenario requiring web page diagnosis

## When Not to Use

- Non-web environments (CLI tools, backend-only services) — outside this skill's scope
- Scheduled production sampling / acceptance checks (use `$roll-sentinel`)
- Pure source-reading without runtime reproduction

## Quick Start

```bash
# Full workflow: mount + collect + analyze + unmount (recommended)
$roll-debug https://example.com/page

# Collect data only, skip analysis
$roll-debug https://example.com/page --no-analyze

# Skip BB mount, use built-in universal collector
$roll-debug https://example.com/page --universal

# Use a custom BB SDK instead of the built-in stub
$roll-debug https://example.com/page --bb-sdk-url https://cdn.example.com/bb.js

# Collect + analyze + auto-fix
$roll-debug https://example.com/page --fix

# Analyze an existing report file (skip collection)
$roll-debug --report /tmp/bb-report.json

# Batch: diagnose multiple pages
$roll-debug https://site.com/page1,https://site.com/page2
$roll-debug --file urls.txt
```

## BB Probe Lifecycle

```
User: "Debug the page"
    │
    ▼
┌─────────────────────────────────────┐
│ 1. Mount BB Probe                   │
│    ├── Check: page already has BB?  │
│    │   ├── Yes → reuse existing     │
│    │   └── No  → inject BB          │
│    │       ├── Built-in stub (default)
│    │       └── Custom SDK (--bb-sdk-url)
│    ├── Wait for initialization      │
│    └── BB button appears on page    │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ 2. Collect diagnostic data          │
│    ├── Console logs                 │
│    ├── Network requests             │
│    ├── DOM state                    │
│    ├── Performance metrics          │
│    └── Screenshot                   │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ 3. Analyze report                   │
│    ├── Read /tmp/bb-report.json     │
│    ├── Root cause analysis          │
│    ├── Issue severity               │
│    └── Structured findings          │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ 4. Unmount BB Probe                 │
│    ├── Restore console/fetch/XHR    │
│    ├── Remove BB button from DOM    │
│    ├── Delete window.__BB_DATA__    │
│    └── Page state fully restored    │
└──────────────────┬──────────────────┘
                   │
                   ▼
    Fix suggestions (or --fix to apply)
```

## Collection Modes

### Mode 1: Mounted BB (Default)

BB probe is mounted on the page — either reused from an existing BB or freshly injected.

**Visual indicator**: a red circular **BB** button appears at the bottom-right of the page.

**Data collected via BB interface**:
- Console logs (error/warn/info)
- Network requests (failed XHR/fetch, slow requests)
- DOM state (key elements visibility, HTML length)
- Performance metrics (load time, FCP, LCP)
- JavaScript errors with stack traces

**BB Sources**:

| Source | When Used | Capability |
|--------|-----------|------------|
| Existing native BB | Page already has `[data-testid="bb-toggle"]` or `window.__BB_DATA__` | Full app-specific metrics (contentState, audioState, etc.) |
| Built-in stub | Default when no BB present | Generic metrics (console, network, DOM, performance, errors) |
| Custom SDK | `--bb-sdk-url` provided | Determined by the SDK implementation |

### Mode 2: Universal Diagnostic (No BB)

When `--universal` is passed, skip BB mount entirely. Use Playwright's built-in event listeners directly.

```bash
$roll-debug https://example.com/page --universal
```

Useful when:
- You explicitly do not want to modify the page state
- The page has strict CSP that blocks script injection
- You need a quick check without probe overhead

## Usage Examples

### Example 1: Full auto-mount + analyze (default)

```bash
$roll-debug https://yyy.up.railway.app/story/cars/chapter/1

🔍 Diagnosing https://yyy.up.railway.app/story/cars/chapter/1
📡 Mounting BB probe...
   ├── Source: built-in stub
   └── Status: ready (320ms)
   └── BB button visible on page ✓
📊 Collecting data via BB...
   ├── Console: 3 errors, 5 warnings
   ├── Network: 2 failed requests
   ├── DOM: #app rendered, .content empty
   └── Screenshot: saved to /tmp/bb-screenshot.png
🔬 Analyzing...
🧹 Unmounting BB probe... done
   └── Page state restored ✓

Report: /tmp/bb-report.json

## Diagnostic Analysis Report

### Basic Info
| Field | Value |
|-------|-------|
| Diagnostic Mode | mounted-bb (stub) |
| Page URL | https://yyy.up.railway.app/story/cars/chapter/1 |

### Key Findings
| Metric | Value | Status |
|--------|-------|--------|
| contentLength | 0 | Not loaded |
| audioState.src | "" | Not set |
| hasText | false | No content |
| Console Errors | 3 | Critical |
| Network Failed | 2 | Critical |

### Diagnosis Conclusion
useEffect dependency error causing content not to load.
Dependency `[chapter?.id]` should be `[chapter?.number]`

### Suggested Fix
Modify Player.tsx line 45, change useEffect dependency
from `[chapter?.id]` to `[chapter?.number]`
```

### Example 2: Reuse existing native BB

```bash
$roll-debug https://example.com/page

🔍 Diagnosing https://example.com/page
📡 Mounting BB probe...
   ├── Native BB detected
   └── Reusing existing probe
📊 Collecting data via BB...
   ├── Console: 0 errors
   ├── Network: 0 failed
   └── DOM: fully rendered
🔬 Analyzing...
🧹 Unmounting BB probe... skipped
   └── Native BB left intact

No issues found. Page is healthy.
```

### Example 3: Universal mode (no BB mount)

```bash
$roll-debug https://example.com --universal

🔍 Diagnosing https://example.com (universal mode)
📡 BB mount skipped (--universal)
📊 Collecting data via Playwright events...
   ├── Console Errors: 2
   │   ├── TypeError: Cannot read property 'id' of undefined
   │   │   at Player.tsx:45
   │   └── ReferenceError: AudioContext is not defined
   ├── Failed Network: 1
   │   └── GET https://api.example.com/data 404
   └── Screenshot: /tmp/bb-screenshot.png
🔬 Analyzing...

Report: /tmp/bb-report.json

### Key Findings
| Metric | Value | Status |
|--------|-------|--------|
| Console Errors | 2 | Critical |
| Network Failed | 1 | Critical |
```

### Example 4: Analyze existing report file

```bash
$roll-debug --report /tmp/bb-report.json

Reading report: /tmp/bb-report.json (mode: mounted-bb)

### Key Findings
...
```

## Analysis: Supported Report Formats

| Format | Source | Description |
|--------|--------|-------------|
| Mounted BB (stub) | Injected built-in stub | `window.__BB_DATA__` via injectable-bb.js |
| Mounted BB (native) | Page with existing Black Box | `window.__BB_DATA__` or `localStorage.bb_diagnostic` |
| Mounted BB (custom) | Custom SDK via `--bb-sdk-url` | Determined by SDK |
| Universal | Playwright native events | Direct event listener data |
| Legacy | Old diagnostic files | Backward compatible |

### Mounted BB Mode Fields

```javascript
const bbData = report.diagnostic.bbData;
bbData.contentState?.hasText
bbData.contentState?.contentLength
bbData.audioState?.src
bbData.audioState?.error
bbData.hasAudio
bbData.errors
bbData.console.errors
bbData.console.warnings
bbData.network.failed
bbData.dom.keyElements
bbData.performance.loadComplete
```

### Universal Mode Fields

```javascript
const d = report.diagnostic;
d.console.errors
d.console.warnings
d.network.failed
d.network.slow
d.dom.title
d.dom['#root']
d.dom.htmlLength
d.performance.loadComplete
d.performance.domContentLoaded
```

## Analysis Report Template

```markdown
## Diagnostic Analysis Report

### Basic Info
| Field | Value |
|-------|-------|
| Diagnostic Mode | {mounted-bb / universal} |
| BB Source | {native / stub / custom-sdk} |
| Page URL | {url} |
| Collected At | {timestamp} |

### Key Findings
| Metric | Value | Status |
|--------|-------|--------|
| Console Errors | {N} | {Critical if >0, OK if 0} |
| Network Failed | {N} | {Critical if >0, OK if 0} |
| DOM Rendering | {status} | {OK / Not rendered} |
| Load Time | {X}ms | {OK <2s, Slow 2-5s, Critical >5s} |

### Diagnosis Conclusion
{Root cause in plain language}

### Suggested Fix
{Actionable fix steps}
```

## Common Issue Patterns

### Blank Page
- `dom.htmlLength < 500` or `dom['#root'].visible = false`
- Fix: Check console errors, add error boundary

### Content Not Loading
- `hasText = false` or `contentLength = 0`
- Fix: Check API, refresh OSS URL, fix useEffect dependencies

### Audio Error
- `audioState.error` exists
- Fix: Refresh signed URL, check audio format compatibility

### Network Failure
- `network.failed` has 4xx/5xx responses
- Fix: Check API routes, add CORS headers

### Performance Issues
- LCP > 5s or DOMContentLoaded > 3s
- Fix: Code-split large bundles, lazy-load images, cache API responses

## Implementation Notes

### BB Mount Flow (Playwright)

```javascript
// Pseudocode for AI agent execution
async function diagnose(page, url, args) {
  log(`🔍 Diagnosing ${url}`);

  // Step 1: Mount
  const bbState = await mountBB(page, args);
  log(`📡 Mounting BB probe...`);
  log(`   ├── Source: ${bbState.source}`); // native / stub / custom
  log(`   └── Status: ${bbState.ready ? 'ready' : 'failed'}`);

  if (bbState.ready && bbState.source !== 'native') {
    log(`   └── BB button visible on page ✓`);
  }

  // Step 2: Collect
  log(`📊 Collecting data via BB...`);
  const data = await collectViaBB(page);

  // Step 3: Analyze
  log(`🔬 Analyzing...`);
  const analysis = await analyze(data);

  // Step 4: Unmount (unless native BB)
  if (bbState.source !== 'native') {
    log(`🧹 Unmounting BB probe...`);
    const ok = await page.evaluate(() => window.__BB_UNMOUNT__?.());
    log(`   └── ${ok ? 'done' : 'failed'}`);
    log(`   └── Page state restored ✓`);
  } else {
    log(`🧹 Unmounting BB probe... skipped`);
    log(`   └── Native BB left intact`);
  }

  return analysis;
}

async function mountBB(page, args) {
  // Check for existing BB
  const hasNative = await page.evaluate(() =>
    !!document.querySelector('[data-testid="bb-toggle"]') || !!window.__BB_DATA__
  );
  if (hasNative) {
    return { source: 'native', ready: true };
  }

  if (args.universal) {
    return { source: 'universal', ready: false };
  }

  // Inject BB
  try {
    if (args.bbSdkUrl) {
      await page.addScriptTag({ url: args.bbSdkUrl });
    } else {
      const stubPath = path.join(__dirname, 'injectable-bb.js');
      await page.addScriptTag({ path: stubPath });
    }

    // Poll for readiness
    const ready = await poll(
      () => page.evaluate(() => !!window.__BB_DATA__),
      { timeout: 5000, interval: 200 }
    );

    return { source: args.bbSdkUrl ? 'custom' : 'stub', ready };
  } catch (e) {
    return { source: 'stub', ready: false, error: e.message };
  }
}
```

### Built-in Stub (`injectable-bb.js`)

The stub is injected via `page.addScriptTag({ path })` when no native BB exists.

**Capabilities**:
- Hooks `console.*` with internal error firewall (stub bugs never leak to page)
- Hooks `fetch` and `XMLHttpRequest` transparently — original behavior fully preserved
- Listens for `error` and `unhandledrejection`
- Captures Performance Navigation Timing + FCP + LCP
- Captures DOM state (title, HTML length, key element visibility)
- Renders a visible **BB** button on the page

**Cleanup**:
- `window.__BB_UNMOUNT__()` restores all modified globals to their original references
- Removes the BB button from DOM
- Deletes `window.__BB_DATA__` and `window.__BB_UNMOUNT__`

### Universal Mode (No BB)

When `--universal` is used, collect via Playwright native events:

```javascript
page.on('console', msg => ...);
page.on('requestfailed', req => ...);
page.on('response', res => ...);
page.on('pageerror', err => ...);
```

No page state is modified.

## Data Output Formats

### Mounted BB Mode

```json
{
  "mode": "mounted-bb",
  "bbSource": "stub",
  "timestamp": "2024-01-15T10:30:00Z",
  "url": "https://example.com/page",
  "bbData": {},
  "mountedAt": 1705315800000,
  "unmountedAt": 1705315805000
}
```

### Universal Mode

```json
{
  "mode": "universal",
  "timestamp": "2024-01-15T10:30:00Z",
  "url": "https://example.com/page",
  "diagnostic": {
    "console": {
      "errors": [{"message": "...", "stack": "...", "timestamp": "..."}],
      "warnings": [],
      "logs": []
    },
    "network": {
      "failed": [{"url": "...", "status": 404, "method": "GET"}],
      "slow": [{"url": "...", "duration": 5000}]
    },
    "dom": {
      "title": "Page Title",
      "htmlLength": 2340,
      "keyElements": {
        "#root": {"exists": true, "visible": true, "text": "..."},
        ".error": {"exists": false}
      }
    },
    "performance": {
      "domContentLoaded": 1200,
      "loadComplete": 2300,
      "firstContentfulPaint": 2300,
      "largestContentfulPaint": 4500
    }
  },
  "screenshots": {
    "viewport": "/tmp/roll-debug-viewport.png",
    "fullPage": "/tmp/roll-debug-fullpage.png"
  }
}
```

## Capability Comparison

| Feature | Mounted BB (stub) | Mounted BB (native) | Universal |
|---------|-------------------|---------------------|-----------|
| Page modification | Yes (mount/unmount) | No (already there) | No |
| Visible BB button | Yes | If native has one | No |
| Console logs | Yes | Yes | Yes |
| Network data | Yes | Yes | Yes |
| DOM state | Detailed | Detailed | Key elements |
| App-specific metrics | No | Yes | No |
| Screenshot | Yes | Yes | Yes |
| Performance metrics | Yes | Yes | Yes |
| Works offline | Yes | Yes | Yes |
| Cleanup on exit | Yes (full restore) | N/A | N/A |

## Safety & Cleanup Guarantees

1. **Stub errors are firewalled** — every hook wraps its internal logic in try/catch. A bug in the stub cannot crash the page.
2. **Original behavior preserved** — fetch/XHR wrappers return the exact same values/throw the exact same errors as the originals.
3. **Full unmount** — `__BB_UNMOUNT__()` restores console, fetch, XHR, removes listeners, removes DOM element, and deletes globals.
4. **Native BB untouched** — if a page already has BB, it is reused but never unmounted.
5. **CSP fallback** — if script injection fails (CSP), automatically falls back to Universal mode.

## Integration with Build Skills

After `$roll-debug` finds issues:

```bash
# For a single-file bug fix
# → Create FIX-XXX in backlog
# → $roll-fix FIX-XXX

# For a complex multi-step fix
# → Create US-XXX in backlog
# → $roll-build US-XXX
```
