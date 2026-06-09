/**
 * US-DOSSIER-001a — the Delivery Dossier design system, layered ON TOP of
 * CHROME_CSS (which owns the palette, type stack, chrome bar and print rules).
 *
 * Token ruling: the 001a spec sketches oxblood `#8B1A1A` / truth-green
 * `#2E7D32`; the chrome palette already carries those roles as `--accent`
 * (#a83825 / #e05b3e dark) and `--pass` (#2f7d3b / #57ab5a dark). "Zero new
 * colors/fonts" is taken literally: every dossier component reuses the chrome
 * variables — no new hex values appear in this file.
 *
 * Components (shared by index / epic / story pages):
 *   masthead+lede · ledger (4 figures) · wish→truth bar · lifecycle spine
 *   (.spine / .mini-spine) · toolbar (search + only-shipping) · epic cards +
 *   progress bar + id chips · status pills · wish-quote · attest banner ·
 *   AC table. Responsive at 680px; print stays chrome-free (CHROME_CSS rule).
 */

/** Dossier component stylesheet — append AFTER `CHROME_CSS` in every page. */
export const DOSSIER_CSS = `
/* ── masthead ── */
.lede { font:16.5px/1.75 var(--serif); color:var(--fg); max-width:640px; margin:6px 0 18px; }
.lede em { font-style:italic; color:var(--accent); }
.masthead .crumb { font:12px/1 var(--mono); color:var(--muted); margin:0 0 14px; }
.masthead .crumb a { color:var(--muted); }
.kv { display:flex; gap:18px; flex-wrap:wrap; font-size:12.5px; color:var(--muted); margin:8px 0 0; }
.kv b { color:var(--fg); font-weight:600; }

/* ── ledger: four figures + wish→truth bar ── */
.ledger { border:1px solid var(--line); border-radius:8px; background:var(--bg-raise);
  padding:16px 18px; margin:18px 0; position:relative; z-index:2; }
.figures { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; }
.figure .num { font:600 30px/1.1 var(--serif); letter-spacing:.01em; }
.figure .num.truth { color:var(--pass); }
.figure .lbl { font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
.wt-bar { margin-top:14px; height:10px; border:1px solid var(--line); border-radius:999px; overflow:hidden;
  background:repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--muted) 28%, transparent) 4px 5px); }
.wt-bar .truth { display:block; height:100%; background:var(--pass); border-radius:999px 0 0 999px; }
.wt-legend { display:flex; justify-content:space-between; font-size:11.5px; color:var(--muted); margin-top:5px; }

/* ── lifecycle spine (full) + mini-spine (rows) ── */
.spine { display:flex; align-items:center; margin:18px 0; position:relative; z-index:2; }
.spine .node { display:flex; flex-direction:column; align-items:center; gap:6px; flex:0 0 auto; text-align:center; }
.spine .dot { width:13px; height:13px; border-radius:50%; border:2px solid var(--line); background:var(--bg-raise); box-sizing:border-box; }
.spine .node.done .dot { border-color:var(--accent); background:var(--accent); }
.spine .node.truth .dot { border-color:var(--pass); background:var(--pass); }
.spine .node .tag { font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); white-space:nowrap; }
.spine .node.done .tag, .spine .node.truth .tag { color:var(--fg); }
.spine .seg { flex:1 1 0; height:2px; background:var(--line); margin:0 6px 18px; }
.spine .seg.done { background:var(--accent); }
.mini-spine { display:inline-flex; align-items:center; vertical-align:middle; }
.mini-spine i { width:7px; height:7px; border-radius:50%; background:none; border:1.5px solid var(--line); box-sizing:border-box; }
.mini-spine i.done { border-color:var(--accent); background:var(--accent); }
.mini-spine i.truth { border-color:var(--pass); background:var(--pass); }
.mini-spine s { width:8px; height:1.5px; background:var(--line); text-decoration:none; }
.mini-spine s.done { background:var(--accent); }

/* ── toolbar: search + only-shipping ── */
.toolbar { display:flex; gap:10px; align-items:center; margin:18px 0 8px; position:relative; z-index:2; }
.toolbar input[type="search"] { flex:1 1 auto; font:13.5px/1 var(--sans); color:var(--fg);
  background:var(--bg-raise); border:1px solid var(--line); border-radius:999px; padding:8px 14px; outline:none; }
.toolbar input[type="search"]:focus { border-color:var(--accent); }
.toolbar label.only { display:flex; gap:6px; align-items:center; font-size:12.5px; color:var(--muted);
  cursor:pointer; white-space:nowrap; }
[data-filtered="1"] .filtered-out { display:none; }

/* ── epic table + chips ── */
.epic-table { width:100%; border-collapse:collapse; position:relative; z-index:2; margin:0 0 8px;
  background:var(--bg-raise); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.epic-table thead th { font:600 11px/1 var(--mono); text-transform:uppercase; letter-spacing:.06em;
  color:var(--muted); text-align:left; padding:9px 14px; border-bottom:1px solid var(--line); background:transparent; }
.epic-table tbody tr { border-top:1px solid var(--line); }
.epic-table tbody tr:first-child { border-top:none; }
.epic-table td, .epic-table th[scope="row"] { padding:11px 14px; vertical-align:top; }
.epic-name { font:600 14.5px/1.3 var(--serif); text-align:left; white-space:nowrap; }
.epic-name a { color:var(--fg); text-decoration:none; }
.epic-name a:hover { color:var(--accent); }
.epic-progress { width:200px; }
.epic-progress .stat { font-size:12px; color:var(--muted); }
.epic-bar { height:7px; border:1px solid var(--line); border-radius:999px; overflow:hidden; margin:6px 0 0;
  background:repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--muted) 28%, transparent) 4px 5px); }
.epic-bar .truth { display:block; height:100%; background:var(--pass); }
.chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
.chip { font:11px/1 var(--mono); border:1px solid var(--line); border-radius:5px; padding:4px 7px;
  color:var(--muted); text-decoration:none; }
.chip:hover { border-color:var(--accent); color:var(--accent); }
.chip.truth { border-color:color-mix(in srgb, var(--pass) 55%, transparent); color:var(--pass); }

/* ── type chips + status pills ── */
.type { font:10.5px/1 var(--mono); letter-spacing:.05em; border-radius:4px; padding:3px 6px; }
.type-US { color:var(--info); border:1px solid color-mix(in srgb, var(--info) 45%, transparent); }
.type-FIX { color:var(--claim); border:1px solid color-mix(in srgb, var(--claim) 45%, transparent); }
.type-REFACTOR { color:var(--block); border:1px solid color-mix(in srgb, var(--block) 45%, transparent); }
.type-IDEA { color:var(--warn); border:1px solid color-mix(in srgb, var(--warn) 45%, transparent); }
.pill { font-size:11px; line-height:1; border-radius:999px; padding:4px 9px; white-space:nowrap; }
.pill.merged { color:var(--pass); border:1px solid color-mix(in srgb, var(--pass) 50%, transparent); }
.pill.cycle { color:var(--warn); border:1px solid color-mix(in srgb, var(--warn) 50%, transparent); }
.pill.backlog { color:var(--muted); border:1px solid var(--line); }

/* ── story rows (epic page) ── */
.story-rows { position:relative; z-index:2; }
.story-row { display:flex; gap:10px; align-items:center; padding:9px 6px; border-bottom:1px solid var(--line);
  text-decoration:none; color:var(--fg); }
.story-row:hover { background:var(--bg-raise); }
.story-row .id { font:12.5px/1 var(--mono); min-width:130px; }
.story-row .title { flex:1 1 auto; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* ── story dossier blocks ── */
.wish-quote { border-left:3px solid var(--accent); padding:6px 14px; margin:10px 0;
  font:15.5px/1.75 var(--serif); font-style:italic; }
.attest-banner { display:flex; gap:12px; align-items:center; border:1px solid color-mix(in srgb, var(--pass) 45%, transparent);
  border-radius:8px; padding:10px 14px; margin:10px 0; }
.attest-banner .mark { font-size:18px; color:var(--pass); }
.ac-table { width:100%; border-collapse:collapse; font-size:13px; }
.ac-table th, .ac-table td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
.ac-table th { font-family:var(--serif); color:var(--muted); letter-spacing:.04em; }

/* ── responsive ── */
@media (max-width:680px) {
  .figures { grid-template-columns:repeat(2, 1fr); }
  .epic-grid { grid-template-columns:1fr; }
  .story-row .id { min-width:0; }
  .story-row .title { white-space:normal; }
}
`;

/**
 * Inline filter script for list pages (search box + "only shipping" toggle).
 * Self-containment holds: inline, zero network, zero external assets — the
 * single-script red line is a REPORT-page contract; list pages carry chrome +
 * this filter. Rows opt in via `data-search` (haystack) and `data-truth`.
 */
export const DOSSIER_FILTER_SCRIPT = `<script>
(function () {
  function norm(s) { return (s || "").toLowerCase(); }
  document.addEventListener("DOMContentLoaded", function () {
    var q = document.querySelector("[data-dossier-search]");
    var only = document.querySelector("[data-dossier-only]");
    var rows = document.querySelectorAll("[data-search]");
    function apply() {
      var needle = norm(q && q.value);
      var ship = !!(only && only.checked);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var hit = !needle || norm(r.getAttribute("data-search")).indexOf(needle) !== -1;
        if (ship && r.getAttribute("data-truth") !== "1") hit = false;
        r.classList.toggle("filtered-out", !hit);
      }
      document.documentElement.setAttribute("data-filtered", needle || ship ? "1" : "0");
    }
    if (q) q.addEventListener("input", apply);
    if (only) only.addEventListener("change", apply);
    apply();
  });
})();
</script>`;
