/**
 * Shared page chrome for every generated meta page (features index → story
 * card → acceptance report) — the「交付档案 · Delivery Dossier」visual language.
 *
 * One aesthetic, three emitters: warm-paper / deep-ink themes, serif display
 * type over a sans body, seal-red accent, hairline ledger rules. Every page is
 * still ONE self-contained file (inline CSS + one inline script, no external
 * assets, offline-openable, print-to-PDF clean).
 *
 * Two standard controls (fixed top-right, hidden in print):
 *  - language: full bilingual copy is embedded as `.lang-en` / `.lang-zh`
 *    spans; `html[data-lang]` shows one side. Default follows the browser
 *    locale; an explicit choice persists in localStorage (`roll-lang`).
 *  - theme: light/dark via `html[data-theme]` overriding prefers-color-scheme;
 *    persists in localStorage (`roll-theme`).
 *
 * No-JS degrade: without the script both language spans render (legacy
 * "EN · 中" feel) and the theme follows the OS — nothing breaks.
 */

/** A bilingual copy pair — exactly one side is visible once chrome JS runs. */
export function bi(en: string, zh: string): string {
  return `<span class="lang-en">${en}</span><span class="lang-zh">${zh}</span>`;
}

/** Dark palette, written once and injected for both the explicit override and the OS default. */
const DARK_VARS =
  `--bg:#161410; --bg-raise:#1d1a14; --fg:#e9e2d0; --muted:#99907a; --line:#38332c; --accent:#e05b3e;` +
  ` --grain:rgba(255,255,255,.018);` +
  ` --pass:#57ab5a; --info:#539bf5; --warn:#c69026; --claim:#e0823d; --fail:#e5534b; --block:#986ee2;`;

/**
 * Base stylesheet: theme variables, dossier typography, ledger layout
 * primitives shared by all meta pages, the chrome bar, language switching and
 * print rules. Page-specific styles append after this.
 */
export const CHROME_CSS = `
:root { color-scheme: light dark;
  --bg:#f6f2e9; --bg-raise:#fdfbf5; --fg:#211d14; --muted:#79705d; --line:#d9d1bd; --accent:#a83825;
  --grain:rgba(60,40,10,.03);
  --pass:#2f7d3b; --info:#2c6cb0; --warn:#9a7b00; --claim:#c4602c; --fail:#c03328; --block:#6e40c9;
  --serif:"Iowan Old Style","Palatino","Book Antiqua",Georgia,"Songti SC","Noto Serif CJK SC",serif;
  --sans:-apple-system,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
:root[data-theme="dark"] { ${DARK_VARS} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK_VARS} } }
html { background:var(--bg); }
body { margin:0 auto; max-width:880px; padding:30px 20px 80px; background:var(--bg); color:var(--fg);
  font:15px/1.7 var(--sans); }
body::after { content:""; position:fixed; inset:0; pointer-events:none; z-index:1;
  background-image:radial-gradient(var(--grain) 1px, transparent 1px); background-size:3px 3px; }
.kicker { font:11.5px/1 var(--serif); letter-spacing:.24em; text-transform:uppercase; color:var(--accent);
  border-top:3px double var(--line); padding-top:10px; margin:0 0 10px; }
h1 { font:600 26px/1.3 var(--serif); margin:0 0 4px; letter-spacing:.01em; }
h2 { font:600 17px/1.4 var(--serif); border-bottom:1px solid var(--line); padding-bottom:6px; letter-spacing:.02em; }
code { font-family:var(--mono); background:rgba(127,110,70,.10); padding:1px 6px; border-radius:4px; font-size:.9em; }
pre { background:rgba(127,110,70,.07); padding:12px; border-radius:6px; overflow-x:auto; }
a { color:var(--accent); text-decoration-color:color-mix(in srgb, var(--accent) 40%, transparent); }
section { border:1px solid var(--line); border-radius:8px; padding:14px 18px; margin:14px 0;
  background:var(--bg-raise); position:relative; z-index:2; }
.empty { color:var(--muted); font-style:italic; }
.meta, .muted { color:var(--muted); font-size:13px; }
footer { color:var(--muted); font-size:12.5px; font-family:var(--serif); letter-spacing:.04em;
  margin-top:40px; border-top:3px double var(--line); padding-top:12px; }
/* language switching — both sides render until the chrome script picks one */
[data-lang="en"] .lang-zh { display:none; } [data-lang="zh"] .lang-en { display:none; }
/* chrome bar */
.chrome { position:fixed; top:14px; right:14px; z-index:10; display:flex; gap:8px; font-family:var(--sans); }
.chrome .seg { display:flex; border:1px solid var(--line); border-radius:999px; overflow:hidden;
  background:color-mix(in srgb, var(--bg-raise) 82%, transparent); backdrop-filter:blur(6px); }
.chrome button { all:unset; cursor:pointer; font-size:12px; line-height:1; padding:7px 11px; color:var(--muted); }
.chrome button.on { background:var(--accent); color:#fdfbf5; }
.chrome button:not(.on):hover { color:var(--fg); }
@media print { body { max-width:none; padding:0; } body::after, .chrome { display:none; }
  section { break-inside:avoid; background:none; } }
`;

/** The fixed top-right control bar: [EN|中] + [☀|☾]. */
export const CHROME_CONTROLS = `<nav class="chrome" aria-label="page controls">
<div class="seg" role="group" aria-label="language"><button type="button" data-set-lang="en">EN</button><button type="button" data-set-lang="zh">中</button></div>
<div class="seg" role="group" aria-label="theme"><button type="button" data-set-theme="light" aria-label="light">☀</button><button type="button" data-set-theme="dark" aria-label="dark">☾</button></div>
</nav>`;

/**
 * The ONLY script on a meta page. Inline (self-contained, offline) — pages
 * still carry no external scripts, no fetches, no third-party code.
 */
export const CHROME_SCRIPT = `<script>
(function () {
  var d = document.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var lang = get("roll-lang") || ((navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en");
  var theme = get("roll-theme") || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  function apply() {
    d.setAttribute("data-lang", lang);
    d.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    d.setAttribute("data-theme", theme);
    var bs = document.querySelectorAll("[data-set-lang],[data-set-theme]");
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      var on = b.getAttribute("data-set-lang") === lang || b.getAttribute("data-set-theme") === theme;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
  }
  apply();
  document.addEventListener("DOMContentLoaded", function () {
    var bs = document.querySelectorAll("[data-set-lang],[data-set-theme]");
    for (var i = 0; i < bs.length; i++) {
      bs[i].addEventListener("click", function () {
        var l = this.getAttribute("data-set-lang");
        var t = this.getAttribute("data-set-theme");
        if (l) { lang = l; set("roll-lang", l); }
        if (t) { theme = t; set("roll-theme", t); }
        apply();
      });
    }
    apply();
  });
})();
</script>`;
