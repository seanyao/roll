// Roll Debug — Injectable BB Diagnostic Stub
// Injected into page context by Playwright when native BB is absent.
// Exposes window.__BB_DATA__ and [data-testid="bb-toggle"] for unified collection.
// Fully unmountable via window.__BB_UNMOUNT__().

(function () {
  'use strict';

  if (window.__BB_DATA__) return; // Already mounted

  // ─── Backup originals ───
  const _orig = {
    console: {},
    fetch: window.fetch,
    XHR_open: XMLHttpRequest.prototype.open,
    XHR_send: XMLHttpRequest.prototype.send,
  };
  ['error', 'warn', 'log', 'info'].forEach((m) => {
    _orig.console[m] = console[m];
  });

  // ─── BB State ───
  const BB = {
    version: 'stub-1.0',
    mountedAt: Date.now(),
    console: { errors: [], warnings: [], logs: [] },
    network: { failed: [], slow: [], all: [] },
    errors: [],
    dom: {},
    performance: {},
  };

  // ─── Console hooks (with internal error firewall) ───
  ['error', 'warn', 'log', 'info'].forEach((m) => {
    const key = m === 'error' ? 'errors' : m === 'warn' ? 'warnings' : 'logs';
    const orig = _orig.console[m];
    console[m] = function bbHookedConsole(...args) {
      try {
        BB.console[key].push({
          message: args
            .map((a) => {
              try {
                return typeof a === 'object' ? JSON.stringify(a) : String(a);
              } catch (e) {
                return '[unstringifiable]';
              }
            })
            .join(' '),
          timestamp: Date.now(),
        });
      } catch (e) {
        /* swallow stub internal error */
      }
      return orig.apply(this, args);
    };
  });

  // ─── Fetch hook (transparent wrapper) ───
  const origFetch = _orig.fetch;
  window.fetch = function bbHookedFetch(...args) {
    const start = Date.now();
    const url =
      typeof args[0] === 'string'
        ? args[0]
        : args[0]?.url || '[unknown]';
    const method = args[1]?.method || 'GET';

    return origFetch.apply(this, args).then(
      (res) => {
        try {
          const duration = Date.now() - start;
          const entry = { url, status: res.status, duration, method };
          BB.network.all.push(entry);
          if (!res.ok) BB.network.failed.push(entry);
          if (duration > 3000) BB.network.slow.push(entry);
        } catch (e) {
          /* swallow */
        }
        return res;
      },
      (err) => {
        try {
          BB.network.failed.push({
            url,
            error: err.message,
            duration: Date.now() - start,
            method,
          });
        } catch (e) {
          /* swallow */
        }
        throw err;
      }
    );
  };
  try {
    window.fetch.toString = () => 'function fetch() { [native code] }';
  } catch (e) {
    /* ignore */
  }

  // ─── XHR hook ───
  XMLHttpRequest.prototype.open = function bbHookedOpen(method, url, ...rest) {
    this._bb = { method, url: String(url), start: null };
    return _orig.XHR_open.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function bbHookedSend(...args) {
    if (this._bb) this._bb.start = Date.now();
    const handler = () => {
      if (!this._bb) return;
      try {
        const duration = Date.now() - this._bb.start;
        const entry = {
          url: this._bb.url,
          status: this.status,
          duration,
          method: this._bb.method,
        };
        BB.network.all.push(entry);
        if (this.status >= 400 || this.status === 0)
          BB.network.failed.push(entry);
        if (duration > 3000) BB.network.slow.push(entry);
      } catch (e) {
        /* swallow */
      }
    };
    this.addEventListener('loadend', handler, { once: true });
    return _orig.XHR_send.apply(this, args);
  };

  // ─── JS Error listeners ───
  const onError = (e) => {
    try {
      BB.errors.push({
        message: e.message,
        stack: e.error?.stack,
        timestamp: Date.now(),
      });
    } catch (e) {
      /* swallow */
    }
  };
  const onRejection = (e) => {
    try {
      BB.errors.push({
        message: e.reason?.message || String(e.reason),
        stack: e.reason?.stack,
        timestamp: Date.now(),
      });
    } catch (e) {
      /* swallow */
    }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  // ─── Performance ───
  const capturePerf = () => {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      BB.performance = {
        domContentLoaded: nav?.domContentLoadedEventEnd,
        loadComplete: nav?.loadEventEnd,
        firstContentfulPaint:
          performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        largestContentfulPaint: performance
          .getEntriesByType('largest-contentful-paint')
          .pop()?.startTime,
      };
    } catch (e) {
      /* swallow */
    }
  };
  if (document.readyState === 'complete') {
    capturePerf();
  } else {
    window.addEventListener('load', capturePerf, { once: true });
  }

  // ─── DOM Capture ───
  function captureDOM() {
    try {
      const info = (sel) => {
        const el = document.querySelector(sel);
        return el
          ? {
              exists: true,
              visible: el.offsetParent !== null,
              text: el.textContent?.slice(0, 200),
            }
          : { exists: false };
      };
      return {
        title: document.title,
        url: location.href,
        htmlLength: document.documentElement.innerHTML.length,
        keyElements: {
          '#root': info('#root'),
          '#app': info('#app'),
          '[data-testid="error"]': info('[data-testid="error"]'),
          '.error': info('.error'),
          '.loading': info('.loading'),
        },
      };
    } catch (e) {
      return { error: 'DOM capture failed', url: location.href };
    }
  }

  // ─── Public API ───
  BB.getData = () => ({ ...BB, dom: captureDOM(), collectedAt: Date.now() });
  window.__BB_DATA__ = BB;

  // ─── Visible BB toggle button ───
  let btn;
  if (document.body) {
    btn = document.createElement('button');
    btn.dataset.testid = 'bb-toggle';
    btn.textContent = 'BB';
    btn.title = 'Black Box Diagnostic Probe — click to download report';
    btn.style.cssText =
      'position:fixed;bottom:12px;right:12px;z-index:99999;' +
      'width:36px;height:36px;border-radius:50%;border:none;' +
      'background:#ff4444;color:#fff;font-size:11px;font-weight:bold;' +
      'font-family:sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);' +
      'display:flex;align-items:center;justify-content:center;' +
      'opacity:0.85;transition:opacity 0.2s;';
    btn.onmouseenter = () => (btn.style.opacity = '1');
    btn.onmouseleave = () => (btn.style.opacity = '0.85');
    btn.onclick = () => {
      const data = BB.getData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bb-diagnostic-${Date.now()}.json`;
      a.click();
    };
    document.body.appendChild(btn);
  }

  // ─── Unmount (restore page to original state) ───
  window.__BB_UNMOUNT__ = function () {
    try {
      ['error', 'warn', 'log', 'info'].forEach(
        (m) => (console[m] = _orig.console[m])
      );
      window.fetch = _orig.fetch;
      XMLHttpRequest.prototype.open = _orig.XHR_open;
      XMLHttpRequest.prototype.send = _orig.XHR_send;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      if (btn) btn.remove();
      delete window.__BB_DATA__;
      delete window.__BB_UNMOUNT__;
      return true;
    } catch (e) {
      return false;
    }
  };
})();
