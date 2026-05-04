# roll-debug BB Injection Mode — Design

> **Context**: `roll-debug` currently has two collection modes:
> 1. **Native BB** — page already has Black Box integrated
> 2. **Universal** — page has no BB; inject a lightweight custom collector
>
> The problem: Universal mode collects data through a custom collector (`__ROLL_DEBUG_COLLECTOR__`), producing a different schema than BB. Analysis logic must handle two schemas. User wants a **third mode** — inject BB SDK when absent — so all data flows through a unified BB interface.

## Goal

Enable `roll-debug` to **dynamically mount a BB-compatible diagnostic collector** on pages that don't natively have one. Data collection口径统一, analysis simplified.

## Three-Tier Detection Strategy

```
Auto-detect collection mode
├── Tier 1: Native BB
│   └── Page already has [data-testid="bb-toggle"] / window.__BB_DATA__
│       → Use native BB interface directly
│
├── Tier 2: BB Injection (NEW)
│   └── Page has NO BB
│       → Inject BB SDK or BB-compatible stub
│       → Wait for initialization (poll with timeout)
│       → Collect via BB interface
│
└── Tier 3: Universal Fallback
    └── Injection failed / timeout / --universal flag
        → Use built-in __ROLL_DEBUG_COLLECTOR__
```

## Approach Comparison

| Approach | How | Pros | Cons | Verdict |
|----------|-----|------|------|---------|
| **A. CDN Injection** | Inject `<script src="${BB_SDK_URL}">` via Playwright | Minimal skill size; always latest BB | Requires network + CDN availability; needs config for SDK URL | **Secondary** — configurable but not default |
| **B. Inline Stub Injection** | Skill bundles a minimal `injectable-bb.js`; Playwright injects via `addScriptTag({ path })` or `evaluate()` | Zero external dependency; deterministic; works offline | Skill size slightly larger; stub must be maintained | **Primary** — default injection method |
| **C. Universal-as-BB** | Keep current Universal collector, but reshape output to match BB schema | No new injection logic | Collector logic still diverges from real BB; maintenance burden | **Rejected** — doesn't achieve "mount a BB" goal |

## Visibility Principle

The BB probe is **visible on the page** during diagnosis. A red circular **BB** button appears at the bottom-right corner. This makes the diagnostic process fully transparent — you always know when a probe is active.

## Selected Approach: B (Inline Stub) + A (CDN) as override

Default flow:
1. Check for native BB
2. If absent, inject **skill-bundled BB stub** (`skills/roll-debug/injectable-bb.js`)
3. Wait for stub to register `window.__BB_DATA__` or render toggle button
4. Collect through BB interface
5. If injection fails after timeout → fallback to Universal

Override:
- `--bb-sdk-url <url>` — force CDN injection instead of stub
- `--universal` — skip injection, go straight to Universal

## Injectable BB Stub Design

The stub is a **minimal diagnostic collector** that exposes the same interface as real BB:

```javascript
// injectable-bb.js — injected into page context by Playwright
(function() {
  if (window.__BB_DATA__) return; // Already exists

  const BB = {
    version: 'stub-1.0',
    collectedAt: Date.now(),
    console: { errors: [], warnings: [], logs: [] },
    network: { failed: [], slow: [], all: [] },
    errors: [],
    dom: {},
    performance: {},

    init() {
      // Hook console
      ['error','warn','log','info'].forEach(m => {
        const orig = console[m];
        console[m] = (...args) => {
          BB.console[m === 'error' ? 'errors' : m === 'warn' ? 'warnings' : 'logs']
            .push({ message: args.map(String).join(' '), timestamp: Date.now() });
          orig.apply(console, args);
        };
      });

      // Hook fetch
      const origFetch = window.fetch;
      window.fetch = async (...args) => {
        const start = Date.now();
        try {
          const res = await origFetch.apply(window, args);
          const duration = Date.now() - start;
          const entry = { url: args[0], status: res.status, duration, method: args[1]?.method || 'GET' };
          BB.network.all.push(entry);
          if (!res.ok) BB.network.failed.push(entry);
          if (duration > 3000) BB.network.slow.push(entry);
          return res;
        } catch (err) {
          BB.network.failed.push({ url: args[0], error: err.message, duration: Date.now() - start });
          throw err;
        }
      };

      // Hook XHR
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      // ... (similar pattern)

      // JS errors
      window.addEventListener('error', e => {
        BB.errors.push({ message: e.message, stack: e.error?.stack, timestamp: Date.now() });
      });
      window.addEventListener('unhandledrejection', e => {
        BB.errors.push({ message: e.reason?.message || String(e.reason), stack: e.reason?.stack, timestamp: Date.now() });
      });

      // Performance
      window.addEventListener('load', () => {
        const nav = performance.getEntriesByType('navigation')[0];
        BB.performance = {
          domContentLoaded: nav?.domContentLoadedEventEnd,
          loadComplete: nav?.loadEventEnd,
          firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
          largestContentfulPaint: performance.getEntriesByType('largest-contentful-paint').pop()?.startTime,
        };
      });
    },

    captureDOM() {
      return {
        title: document.title,
        htmlLength: document.documentElement.innerHTML.length,
        url: location.href,
        keyElements: {
          '#root': { exists: !!document.querySelector('#root'), visible: !!document.querySelector('#root')?.offsetParent },
          '#app': { exists: !!document.querySelector('#app'), visible: !!document.querySelector('#app')?.offsetParent },
          '[data-testid="error"]': { exists: !!document.querySelector('[data-testid="error"]') },
        }
      };
    },

    getData() {
      return {
        ...BB,
        dom: BB.captureDOM(),
        collectedAt: Date.now(),
      };
    }
  };

  BB.init();
  window.__BB_DATA__ = BB;

  // Also render a toggle button so Native detection works
  const btn = document.createElement('button');
  btn.dataset.testid = 'bb-toggle';
  btn.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99999;width:1px;height:1px;opacity:0;';
  btn.onclick = () => {
    const data = BB.getData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bb-diagnostic-${Date.now()}.json`;
    a.click();
  };
  document.body.appendChild(btn);
})();
```

**Key design decisions:**
- Stub exposes `window.__BB_DATA__` AND renders `[data-testid="bb-toggle"]` — makes it indistinguishable from native BB for detection logic
- Output schema matches Native BB format — analysis code handles one schema
- Tiny (invisible) button allows the same "click to download" workflow as native BB
- No cleanup needed — lives only in Playwright browser context

## Injection & Detection Flow (Playwright)

```javascript
// Pseudocode for AI agent execution
async function detectAndCollect(page) {
  // Tier 1: Native BB
  const hasNativeBB = await page.evaluate(() =>
    !!document.querySelector('[data-testid="bb-toggle"]') || !!window.__BB_DATA__
  );
  if (hasNativeBB) {
    return { mode: 'native-bb', data: await collectNativeBB(page) };
  }

  // Tier 2: BB Injection
  if (!args.universal) {
    const injected = await injectBB(page, args.bbSdkUrl); // null = use stub
    if (injected) {
      // Poll for BB readiness
      const ready = await poll(() => page.evaluate(() => !!window.__BB_DATA__), { timeout: 5000 });
      if (ready) {
        // Give a moment for hooks to catch initial errors
        await page.waitForTimeout(500);
        return { mode: 'injected-bb', data: await collectNativeBB(page) };
      }
    }
  }

  // Tier 3: Universal Fallback
  return { mode: 'universal', data: await collectUniversal(page) };
}

async function injectBB(page, sdkUrl) {
  try {
    if (sdkUrl) {
      // CDN injection
      await page.addScriptTag({ url: sdkUrl });
    } else {
      // Inline stub injection
      const stubPath = path.join(__dirname, 'injectable-bb.js');
      await page.addScriptTag({ path: stubPath });
    }
    return true;
  } catch (e) {
    return false;
  }
}
```

## CLI Interface Changes

```bash
# New flags
$roll-debug https://example.com/page --bb-sdk-url https://cdn.example.com/bb.js
$roll-debug https://example.com/page --universal          # skip injection
$roll-debug https://example.com/page --inject-bb          # force injection even if native found (unlikely needed)
```

## Report Schema

```json
{
  "mode": "injected-bb",
  "timestamp": "2024-01-15T10:30:00Z",
  "url": "https://example.com/page",
  "bbData": { /* same schema as native BB */ },
  "injection": {
    "source": "stub", // or "cdn"
    "initTimeMs": 320
  }
}
```

## Compatibility Matrix (Updated)

| Feature | Native BB | Injected BB | Universal |
|---------|-----------|-------------|-----------|
| Requires page integration | Yes | No | No |
| Console logs | Yes | Yes | Yes |
| Network data | Yes | Yes | Yes |
| DOM state | Detailed | Detailed | Key elements |
| App-specific metrics | Yes | No | No |
| Screenshot | Yes | Yes | Yes |
| Performance metrics | Yes | Yes | Yes |
| Works offline | Yes | Yes | Yes |
| Output schema | BB native | BB native | Universal |

## Files to Create/Modify

1. `skills/roll-debug/SKILL.md` — update workflow, add Mode 3, new flags, new examples
2. `skills/roll-debug/injectable-bb.js` — new file, the BB stub
3. `docs/features/roll-debug.md` — US details
4. `BACKLOG.md` — add index row

## Open Questions (Resolved)

1. **Where does BB SDK come from?** → Default: skill-bundled stub. Override: `--bb-sdk-url`.
2. **What if injection fails?** → Timeout after 5s, fallback to Universal.
3. **Should stub support app-specific metrics?** → No. Stub is generic; app-specific metrics only available in Native BB.
4. **Does this replace Universal mode?** → No. Universal remains as ultimate fallback and for `--universal` flag.
