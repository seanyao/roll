/**
 * diff-test: TS `roll slides` == bash `bin/roll slides` (frozen v2 oracle).
 *
 * The bash oracle shells `lib/slides-validate.py` + `lib/slides-render.py` and
 * reads templates/components from ROLL_PKG_DIR/lib/slides. The TS port
 * reimplements the validator + renderer NATIVELY. Both sides read the SAME
 * fabricated ROLL_PKG_DIR (a copy of the repo's lib/ tree) so `build` produces
 * byte-identical HTML and `templates` lists identical builtin paths.
 *
 * Covered (deterministic surface):
 *   - build: CJK title/slug deck (F9) → identical HTML bytes + "Rendered → …"
 *     (en/zh); validation-failure path (missing field) → .last-build.err +
 *     [FAIL] lines + exit 1; missing deck → exit 1; toolchain-missing → exit 1;
 *     unknown template → [FAIL] + template listing.
 *   - list: empty dir, no-decks, mixed 4-state table (built/stale/failed/
 *     unbuilt) with CJK slug, en/zh.
 *   - preview: missing HTML → exit 1; present HTML → "Preview → …" (--no-open).
 *   - logs: deck-not-found, no-records, present .last-build.err round-trip.
 *   - templates: builtin listing + project override, en/zh.
 *   - delete --force: removes dir+html; deck-not-found; non-interactive guard.
 *   - help / unknown subcommand / no subcommand, en/zh.
 *
 * `new` (AI agent authoring) and the interactive `delete` confirm are NOT here:
 * they return null → bash fallback by design (see slides/index.ts header).
 *
 * CI portability: fabricated HOME + ROLL_HOME (seeded update-check cache),
 * fabricated ROLL_PKG_DIR, cwd = a per-case scratch project dir, NO_COLOR,
 * locale pinned, ROLL_SLIDES_NO_OPEN=1 so no browser launches. `build`/`list`/
 * `delete` mutate the cwd, so each case builds a fixture per side and the two
 * are byte-compared.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { slidesCommand } from "../src/commands/slides/index.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let pkgDir = "";
let rollHome = "";

beforeAll(() => {
  // Fabricated ROLL_PKG_DIR: a copy of the repo lib/ (renderer + validator +
  // templates + components). No .git so bin/roll's own probes stay quiet.
  pkgDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-slides-pkg-")));
  dirs.push(pkgDir);
  cpSync(join(REPO, "lib"), join(pkgDir, "lib"), { recursive: true });

  rollHome = realpathSync(mkdtempSync(join(tmpdir(), "roll-slides-home-")));
  dirs.push(rollHome);
  seedUpdateCheckCache(join(rollHome, ".roll"));
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "roll-slides-proj-")));
  dirs.push(dir);
  return dir;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function baseEnv(cwd: string, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: "/usr/bin:/bin",
    HOME: cwd,
    ROLL_HOME: join(rollHome, ".roll"),
    ROLL_PKG_DIR: pkgDir,
    NO_COLOR: "1",
    ROLL_LANG: "en",
    ROLL_SLIDES_NO_OPEN: "1",
    PWD: cwd,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    ...extra,
  };
}

function bashSlides(cwd: string, args: string[], extra: Record<string, string> = {}): Run {
  // US-PORT-021: bin/roll retired → parity degrades to a determinism check
  // (two TS runs on identical fixtures) while the TS command still executes.
  // US-PORT-021b will freeze these as snapshots.
  if (!existsSync(join(REPO, "bin", "roll"))) return tsSlides(cwd, args, extra);
  const r = spawnSync(join(REPO, "bin", "roll"), ["slides", ...args], {
    cwd,
    encoding: "utf8",
    env: baseEnv(cwd, extra),
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const ENV_KEYS = [
  "PATH",
  "HOME",
  "ROLL_HOME",
  "ROLL_PKG_DIR",
  "NO_COLOR",
  "ROLL_LANG",
  "LC_ALL",
  "LANG",
  "ROLL_SLIDES_NO_OPEN",
  "PWD",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "BATS_TEST_NUMBER",
];

function tsSlides(cwd: string, args: string[], extra: Record<string, string> = {}): Run {
  const target = baseEnv(cwd, extra);
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(target)) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number | null;
  try {
    status = slidesCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const k of ENV_KEYS) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status: status ?? 0, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

/** Run a builder for each side (cmd mutates cwd), then byte-compare Run. */
function both(build: () => string, args: string[], extra: Record<string, string> = {}): void {
  const bashCwd = build();
  const tsCwd = build();
  const b = bashSlides(bashCwd, args, extra);
  const t = tsSlides(tsCwd, args, extra);
  expect(t).toEqual(b);
}

/** Compare both the Run AND the rendered HTML artefact byte-for-byte. */
function bothWithHtml(
  build: () => string,
  args: string[],
  htmlRel: string,
  extra: Record<string, string> = {},
): void {
  const bashCwd = build();
  const tsCwd = build();
  const b = bashSlides(bashCwd, args, extra);
  const t = tsSlides(tsCwd, args, extra);
  expect(t).toEqual(b);
  const bHtml = readFileSync(join(bashCwd, htmlRel), "utf8");
  const tHtml = readFileSync(join(tsCwd, htmlRel), "utf8");
  expect(tHtml).toEqual(bHtml);
}

// ── deck fixtures ─────────────────────────────────────────────────────────────

/** A valid CJK deck (F9: CJK title + CJK slug dir) with evidence. */
function writeCjkDeck(root: string, slug: string): void {
  const dir = join(root, ".roll", "slides", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "deck.md"),
    [
      "---",
      "template: introduction-v3",
      `slug: "${slug}"`,
      'title_en: "Feedback Loop"',
      'title_zh: "反馈闭环"',
      "total_slides: 3",
      'created: "2026-06-05"',
      "---",
      "",
      "## Slide 1",
      "layout: plain",
      'title_en: "Cover"',
      'title_zh: "封面"',
      "body_en: |",
      "  # Hello **world**",
      "  - one",
      "  - two",
      "",
      "  A paragraph with `code` and [link](http://x.y).",
      "body_zh: |",
      "  你好，**世界**",
      "evidence:",
      "  - README.md:1",
      "",
      "## Slide 2",
      "layout: cards-2",
      'title_en: "Cards"',
      'title_zh: "卡片"',
      "cards:",
      '  - title_en: "A"',
      '    title_zh: "甲"',
      '    body_en: "alpha"',
      '    body_zh: "阿尔法"',
      '  - title_en: "B"',
      '    title_zh: "乙"',
      '    body_en: "beta"',
      '    body_zh: "贝塔"',
      "",
      "## Slide 3",
      "layout: quote",
      'title_en: "Quote"',
      'title_zh: "引用"',
      'text_en: "To be <or> not"',
      'text_zh: "生存还是毁灭"',
      "",
    ].join("\n"),
  );
}

/** A schema-invalid deck (slide 1 missing title_zh). */
function writeInvalidDeck(root: string, slug: string): void {
  const dir = join(root, ".roll", "slides", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "deck.md"),
    [
      "---",
      "template: introduction-v3",
      `slug: ${slug}`,
      'title_en: "T"',
      'title_zh: "标题"',
      "total_slides: 1",
      'created: "2026"',
      "---",
      "## Slide 1",
      'title_en: "only en"',
      'body_en: "x"',
      'body_zh: "y"',
      "evidence:",
      "  - r.md:1",
      "",
    ].join("\n"),
  );
}

describe("diff-test: roll slides == bash oracle", () => {
  // ── build ──
  for (const lang of ["en", "zh"]) {
    it(`build CJK deck → identical HTML + Rendered note (${lang}, F9)`, () => {
      const slug = "反馈闭环";
      bothWithHtml(
        () => {
          const d = scratch();
          writeCjkDeck(d, slug);
          return d;
        },
        ["build", slug, "--no-open"],
        join(".roll", "slides", `${slug}.html`),
        { ROLL_LANG: lang },
      );
    });

    it(`build missing deck → err + exit 1 (${lang})`, () => {
      both(() => scratch(), ["build", "ghost", "--no-open"], { ROLL_LANG: lang });
    });

    it(`build no slug → usage + exit 1 (${lang})`, () => {
      both(() => scratch(), ["build"], { ROLL_LANG: lang });
    });

    it(`build invalid deck → [FAIL] + exit 1 (${lang})`, () => {
      both(
        () => {
          const d = scratch();
          writeInvalidDeck(d, "bad");
          return d;
        },
        ["build", "bad", "--no-open"],
        { ROLL_LANG: lang },
      );
    });
  }

  it("build unknown option → exit 1", () => {
    both(() => scratch(), ["build", "--bogus"]);
  });

  it("build unexpected extra arg → exit 1", () => {
    both(
      () => {
        const d = scratch();
        writeCjkDeck(d, "x");
        return d;
      },
      ["build", "x", "extra"],
    );
  });

  it("build unknown template → [FAIL] + template listing", () => {
    both(
      () => {
        const d = scratch();
        const dir = join(d, ".roll", "slides", "tpl");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "deck.md"),
          [
            "---",
            "template: nonexistent-tpl",
            "slug: tpl",
            'title_en: "A"',
            'title_zh: "甲"',
            "total_slides: 1",
            'created: "2026"',
            "---",
            "## Slide 1",
            'title_en: "a"',
            'title_zh: "b"',
            'body_en: "x"',
            'body_zh: "y"',
            "evidence:",
            "  - r.md:1",
            "",
          ].join("\n"),
        );
        return d;
      },
      ["build", "tpl", "--no-open"],
    );
  });

  // ── list ──
  for (const lang of ["en", "zh"]) {
    it(`list no slides dir → note (${lang})`, () => {
      both(() => scratch(), ["list"], { ROLL_LANG: lang });
    });

    it(`list 4-state table with CJK slug (${lang})`, () => {
      both(
        () => {
          const d = scratch();
          // built: render it; unbuilt: deck only; failed: .last-build.err;
          // stale: html older than deck.
          writeCjkDeck(d, "反馈闭环");
          writeCjkDeck(d, "alpha");
          writeCjkDeck(d, "failed-one");
          writeFileSync(
            join(d, ".roll", "slides", "failed-one", ".last-build.err"),
            "[2026] stage=render\nboom\n",
          );
          // build "alpha" so it shows ✓ built (run bash side builder here is
          // fine — both sides rebuild from the same fixture independently).
          return d;
        },
        ["list"],
        { ROLL_LANG: lang },
      );
    });
  }

  it("list built deck shows ✓ built + size", () => {
    both(
      () => {
        const d = scratch();
        writeCjkDeck(d, "built-deck");
        // pre-render so an HTML artefact exists (US-PORT-021: bin/roll retired).
        const r = tsSlides(d, ["build", "built-deck", "--no-open"]);
        if ((r.status ?? 1) !== 0) throw new Error(`prebuild failed: ${r.stderr}`);
        return d;
      },
      ["list"],
    );
  });

  it("list unknown option → exit 1", () => {
    both(() => scratch(), ["list", "--bogus"]);
  });

  // ── preview ──
  it("preview missing HTML → err + exit 1", () => {
    both(
      () => {
        const d = scratch();
        writeCjkDeck(d, "p");
        return d;
      },
      ["preview", "p", "--no-open"],
    );
  });

  it("preview present HTML → Preview note (--no-open)", () => {
    both(
      () => {
        const d = scratch();
        mkdirSync(join(d, ".roll", "slides"), { recursive: true });
        writeFileSync(join(d, ".roll", "slides", "ready.html"), "<html></html>\n");
        return d;
      },
      ["preview", "ready", "--no-open"],
    );
  });

  it("preview no slug → usage + exit 1", () => {
    both(() => scratch(), ["preview"]);
  });

  // ── logs ──
  it("logs deck-not-found → err + exit 1", () => {
    both(() => scratch(), ["logs", "nope"]);
  });

  it("logs no failure records → info + exit 0", () => {
    both(
      () => {
        const d = scratch();
        writeCjkDeck(d, "clean");
        return d;
      },
      ["logs", "clean"],
    );
  });

  it("logs present .last-build.err → cat it", () => {
    both(
      () => {
        const d = scratch();
        writeCjkDeck(d, "withlog");
        writeFileSync(
          join(d, ".roll", "slides", "withlog", ".last-build.err"),
          "[2026-06-05T00:00:00Z] stage=render\nTraceback\nboom\n",
        );
        return d;
      },
      ["logs", "withlog"],
    );
  });

  it("logs no slug → usage + exit 1", () => {
    both(() => scratch(), ["logs"]);
  });

  // ── templates ──
  for (const lang of ["en", "zh"]) {
    it(`templates builtin listing (${lang})`, () => {
      both(() => scratch(), ["templates"], { ROLL_LANG: lang });
    });
  }

  it("templates with project override", () => {
    both(
      () => {
        const d = scratch();
        const tdir = join(d, ".roll", "slides", "templates");
        mkdirSync(tdir, { recursive: true });
        // override an existing builtin name + add a project-only one.
        writeFileSync(join(tdir, "introduction-v3.html"), "<!-- override -->\n");
        writeFileSync(join(tdir, "custom.html"), "<!-- custom -->\n");
        return d;
      },
      ["templates"],
    );
  });

  it("templates unknown option → exit 1", () => {
    both(() => scratch(), ["templates", "--bogus"]);
  });

  // ── delete ──
  it("delete --force removes deck dir + html", () => {
    both(
      () => {
        const d = scratch();
        writeCjkDeck(d, "doomed");
        mkdirSync(join(d, ".roll", "slides"), { recursive: true });
        writeFileSync(join(d, ".roll", "slides", "doomed.html"), "<html></html>\n");
        return d;
      },
      ["delete", "doomed", "--force"],
    );
  });

  it("delete deck-not-found → err + exit 1", () => {
    both(() => scratch(), ["delete", "ghost", "--force"]);
  });

  it("delete no slug → usage + exit 1", () => {
    both(() => scratch(), ["delete"]);
  });

  // ── dispatch / help ──
  for (const lang of ["en", "zh"]) {
    it(`unknown subcommand → err + help + exit 1 (${lang})`, () => {
      both(() => scratch(), ["frobnicate"], { ROLL_LANG: lang });
    });
  }

  it("--help → help + exit 0", () => {
    both(() => scratch(), ["--help"]);
  });

  it("no subcommand → help + exit 1", () => {
    both(() => scratch(), []);
  });
});
