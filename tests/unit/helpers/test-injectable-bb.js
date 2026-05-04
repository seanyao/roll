// Node.js smoke test for injectable-bb.js
// Simulates a minimal browser environment to verify stub behavior.

'use strict';

const assert = require('assert');
const path = require('path');

// Keep original console for debugging output
const _stdout = process.stdout.write.bind(process.stdout);
const _stderr = process.stderr.write.bind(process.stderr);

// ─── Minimal browser mocks ───
const elements = [];

function mockElement(tag) {
  return {
    tagName: tag,
    dataset: {},
    style: {},
    textContent: '',
    _listeners: {},
    addEventListener(ev, fn, opts) {
      (this._listeners[ev] = this._listeners[ev] || []).push(fn);
    },
    removeEventListener(ev, fn) {
      if (this._listeners[ev]) {
        this._listeners[ev] = this._listeners[ev].filter((f) => f !== fn);
      }
    },
    dispatchEvent(ev) {
      (this._listeners[ev.type] || []).forEach((fn) => fn(ev));
    },
    remove() {
      const idx = elements.indexOf(this);
      if (idx >= 0) elements.splice(idx, 1);
    },
    click() {
      if (this.onclick) this.onclick();
    },
    offsetParent: true,
  };
}

const mockDoc = {
  title: 'Test Page',
  readyState: 'complete',
  documentElement: { innerHTML: '<html><body><div id="root">hello</div></body></html>' },
  body: {
    appendChild(el) {
      elements.push(el);
      return el;
    },
    removeChild(el) {
      const idx = elements.indexOf(el);
      if (idx >= 0) elements.splice(idx, 1);
    },
    children: elements,
  },
  querySelector(sel) {
    if (sel === '[data-testid="bb-toggle"]') {
      return elements.find((el) => el.dataset?.testid === 'bb-toggle') || null;
    }
    if (sel === '#root') {
      return { offsetParent: true, textContent: 'hello' };
    }
    return null;
  },
  createElement(tag) {
    return mockElement(tag);
  },
  createElementNS(ns, tag) {
    return mockElement(tag);
  },
};

const consoleCalls = [];
const origConsole = {
  error: function (...args) {
    consoleCalls.push({ method: 'error', args });
  },
  warn: function (...args) {
    consoleCalls.push({ method: 'warn', args });
  },
  log: function (...args) {
    consoleCalls.push({ method: 'log', args });
  },
  info: function (...args) {
    consoleCalls.push({ method: 'info', args });
  },
};

const origFetch = function (...args) {
  return Promise.resolve({ status: 200, ok: true });
};

const MockXHR = function () {
  this._bb = null;
  this.status = 200;
  this._listeners = {};
};
MockXHR.prototype.open = function (method, url, ...rest) {
  this._bb = { method, url, start: null };
};
MockXHR.prototype.send = function (...args) {
  if (this._bb) this._bb.start = Date.now();
};
MockXHR.prototype.addEventListener = function (ev, fn, opts) {
  (this._listeners[ev] = this._listeners[ev] || []).push(fn);
};
MockXHR.prototype.dispatchEvent = function (ev) {
  (this._listeners[ev.type] || []).forEach((fn) => fn(ev));
};

const origXHR_open = MockXHR.prototype.open;
const origXHR_send = MockXHR.prototype.send;

const eventListeners = {};
const mockWindow = {
  fetch: origFetch,
  console: origConsole,
  addEventListener(ev, fn, opts) {
    (eventListeners[ev] = eventListeners[ev] || []).push(fn);
  },
  removeEventListener(ev, fn) {
    if (eventListeners[ev]) {
      eventListeners[ev] = eventListeners[ev].filter((f) => f !== fn);
    }
  },
  dispatchEvent(ev) {
    (eventListeners[ev.type] || []).forEach((fn) => fn(ev));
  },
  performance: {
    getEntriesByType() {
      return [];
    },
    getEntriesByName() {
      return [];
    },
  },
  location: { href: 'https://test.com/page' },
  document: mockDoc,
};

// ─── Inject globals ───
global.window = mockWindow;
global.document = mockDoc;
global.console = origConsole;
global.fetch = origFetch;
global.XMLHttpRequest = MockXHR;
global.location = mockWindow.location;
global.performance = mockWindow.performance;

// ─── Load stub ───
const stubPath = path.join(__dirname, '../../../skills/roll-debug/injectable-bb.js');
try {
  require(stubPath);
} catch (e) {
  _stderr('Failed to load stub: ' + e.message + '\n');
  _stderr(e.stack + '\n');
  process.exit(1);
}

// In browser, fetch === window.fetch. Sync Node.js global to match.
global.fetch = global.window.fetch;

// ─── Async test runner ───
async function runTests() {
  // 1. __BB_DATA__ exists
  assert(window.__BB_DATA__, '__BB_DATA__ should be created');
  assert.strictEqual(window.__BB_DATA__.version, 'stub-1.0');
  _stdout('✓ __BB_DATA__ created\n');

  // 2. BB toggle button visible
  const btn = document.querySelector('[data-testid="bb-toggle"]');
  assert(btn, 'BB toggle button should exist');
  assert.strictEqual(btn.textContent, 'BB');
  assert.strictEqual(btn.dataset.testid, 'bb-toggle');
  _stdout('✓ BB toggle button visible\n');

  // 3. Console hook captures errors
  console.error('test error message');
  assert(window.__BB_DATA__.console.errors.length >= 1, 'console errors should be captured');
  assert(window.__BB_DATA__.console.errors[0].message.includes('test error message'));
  _stdout('✓ Console hook works\n');

  // 4. Fetch hook captures requests (async)
  await fetch('https://api.test.com/data');
  await new Promise((r) => setTimeout(r, 10));
  assert(window.__BB_DATA__.network.all.length >= 1, 'fetch should be captured');
  assert.strictEqual(window.__BB_DATA__.network.all[0].url, 'https://api.test.com/data');
  _stdout('✓ Fetch hook works\n');

  // 5. XHR hook captures requests (trigger loadend)
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://xhr.test.com/data');
  xhr.send();
  xhr.dispatchEvent({ type: 'loadend' });
  assert(window.__BB_DATA__.network.all.length >= 2, 'XHR should be captured');
  assert.strictEqual(window.__BB_DATA__.network.all[1].url, 'https://xhr.test.com/data');
  _stdout('✓ XHR hook works\n');

  // 6. Error listener captured
  const beforeErrCount = window.__BB_DATA__.errors.length;
  window.dispatchEvent({ type: 'error', message: 'oops', error: { stack: 'at line 1' } });
  assert(window.__BB_DATA__.errors.length > beforeErrCount, 'errors should be captured');
  _stdout('✓ Error listener works\n');

  // 7. __BB_UNMOUNT__ exists and works
  assert(typeof window.__BB_UNMOUNT__ === 'function', '__BB_UNMOUNT__ should exist');
  const result = window.__BB_UNMOUNT__();
  assert.strictEqual(result, true, 'unmount should return true');
  _stdout('✓ __BB_UNMOUNT__ works\n');

  // 8. After unmount: __BB_DATA__ deleted
  assert.strictEqual(window.__BB_DATA__, undefined, '__BB_DATA__ should be deleted');
  _stdout('✓ __BB_DATA__ deleted after unmount\n');

  // 9. After unmount: button removed
  assert.strictEqual(
    document.querySelector('[data-testid="bb-toggle"]'),
    null,
    'button should be removed'
  );
  _stdout('✓ Button removed after unmount\n');

  // 10. After unmount: console restored
  assert.strictEqual(console.error, origConsole.error, 'console.error should be restored');
  assert.strictEqual(console.warn, origConsole.warn, 'console.warn should be restored');
  _stdout('✓ Console restored after unmount\n');

  // 11. After unmount: fetch restored
  assert.strictEqual(window.fetch, origFetch, 'fetch should be restored');
  _stdout('✓ Fetch restored after unmount\n');

  // 12. After unmount: XHR prototype restored
  assert.strictEqual(XMLHttpRequest.prototype.open, origXHR_open, 'XHR.open should be restored');
  assert.strictEqual(XMLHttpRequest.prototype.send, origXHR_send, 'XHR.send should be restored');
  _stdout('✓ XHR restored after unmount\n');

  _stdout('\nAll tests passed.\n');
}

runTests().catch((err) => {
  _stderr('Test failed: ' + err.message + '\n');
  _stderr(err.stack + '\n');
  process.exit(1);
});
