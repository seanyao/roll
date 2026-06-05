/**
 * US-ATTEST-002 — ANSI→HTML pins: searchable text out, real-world SGR subset
 * styled, fancy sequences dropped-not-garbled, HTML always escaped.
 */
import { describe, expect, it } from "vitest";
import { ANSI_CSS, ansiPre, ansiToHtml } from "../src/attest/ansi-html.js";

const E = "\x1b[";

describe("ansiToHtml", () => {
  it("plain text passes through escaped (searchable)", () => {
    expect(ansiToHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });

  it("styles the vitest/git palette: fg colors, bold, dim, reset", () => {
    const s = `${E}32m✓ pass${E}0m ${E}31;1mFAIL${E}0m ${E}2mskipped${E}0m`;
    const h = ansiToHtml(s);
    expect(h).toContain('<span class="a-fg32">✓ pass</span>');
    expect(h).toContain('<span class="a-fg31 a-bold">FAIL</span>');
    expect(h).toContain('<span class="a-dim">skipped</span>');
  });

  it("bright colors and underline/italic map to classes", () => {
    const h = ansiToHtml(`${E}93;4mwarn${E}0m ${E}3mnote${E}0m`);
    expect(h).toContain('class="a-fg93 a-underline"');
    expect(h).toContain('class="a-italic"');
  });

  it("256-color and truecolor are consumed, text survives unstyled", () => {
    const h = ansiToHtml(`${E}38;5;196mred256${E}0m ${E}38;2;255;0;0mtruered${E}0m`);
    expect(h).toContain("red256");
    expect(h).toContain("truered");
    expect(h).not.toContain("a-fg38");
    expect(h).not.toContain("undefined");
  });

  it("\\r progress overwrites keep only the final paint per line", () => {
    const h = ansiToHtml("downloading 10%\rdownloading 60%\rdone 100%\nnext line");
    expect(h).toBe("done 100%\nnext line");
  });

  it("OSC titles and lone escapes are dropped", () => {
    const h = ansiToHtml("\x1b]0;window title\x07hello");
    expect(h).toBe("hello");
  });

  it("bare ESC[m acts as reset (code 0 shorthand)", () => {
    const h = ansiToHtml(`${E}31mred${E}mplain`);
    expect(h).toBe('<span class="a-fg31">red</span>plain');
  });
});

describe("ansiPre / ANSI_CSS", () => {
  it("wraps in <pre class=ansi> and the CSS covers every emitted class family", () => {
    expect(ansiPre("x")).toBe('<pre class="ansi">x</pre>');
    for (const cls of ["a-bold", "a-dim", "a-italic", "a-underline", "a-fg31", "a-fg32", "a-fg93"]) {
      expect(ANSI_CSS).toContain(`.${cls}`);
    }
    expect(ANSI_CSS).toContain("prefers-color-scheme");
  });
});
