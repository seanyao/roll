import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { nextCommand } from "../src/commands/next.js";

const dirs: string[] = [];

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-next-command-"));
  dirs.push(dir);
  return dir;
}

function write(root: string, rel: string, text = "x\n"): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function mkdir(root: string, rel: string): void {
  mkdirSync(join(root, rel), { recursive: true });
}

function runNext(cwd: string, args: string[] = []): Run {
  const saveCwd = process.cwd();
  const saveEnv = {
    NO_COLOR: process.env["NO_COLOR"],
    ROLL_LANG: process.env["ROLL_LANG"],
  };
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.chdir(cwd);
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  // @ts-expect-error capture-only
  process.stdout.write = (chunk: string | Uint8Array): boolean => (out.push(String(chunk)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (chunk: string | Uint8Array): boolean => (err.push(String(chunk)), true);
  try {
    return { status: nextCommand(args), stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    if (saveEnv.NO_COLOR === undefined) delete process.env["NO_COLOR"];
    else process.env["NO_COLOR"] = saveEnv.NO_COLOR;
    if (saveEnv.ROLL_LANG === undefined) delete process.env["ROLL_LANG"];
    else process.env["ROLL_LANG"] = saveEnv.ROLL_LANG;
  }
}

function tree(root: string): string[] {
  if (!existsSync(root)) return [];
  const rows: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = relative(root, path);
      const st = statSync(path);
      if (st.isDirectory()) {
        rows.push(`${rel}/`);
        walk(path);
      } else {
        rows.push(`${rel}:${readFileSync(path, "utf8")}`);
      }
    }
  };
  walk(root);
  return rows;
}

function writeReadyBacklog(root: string, rows: string[]): void {
  write(root, "AGENTS.md", "# Agents\n");
  mkdir(root, ".roll/features");
  write(root, ".roll/backlog.md", ["| ID | Description | Status |", "|---|---|---|", ...rows].join("\n") + "\n");
}

function scrub(text: string): string {
  return text
    .replace(/workspace: .+roll-next-journey-[^\n]+/g, "workspace: <journey-workspace>")
    .replace(/cleanup: removed .+roll-next-journey-[^\n]+/g, "cleanup: removed <journey-workspace>");
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("roll next", () => {
  it("routes PRD-only workspaces to design from the source document", () => {
    const cwd = project();
    write(cwd, "docs/PRD.md", "# Radar\n\nA product requirements document for an app.\n");

    const run = runNext(cwd);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatchInlineSnapshot(`
      "roll next
      State: prd-only
      Next: roll design --from-file docs/PRD.md
      Why: Product or requirements documents found without source/manifests.
      "
    `);
  });

  it("prefers a pending onboard plan over re-running diagnosis", () => {
    const cwd = project();
    mkdir(cwd, ".roll");
    write(cwd, ".roll/init-diagnosis.yaml", "kind: codebase-no-roll\n");
    write(cwd, ".roll/onboard-plan.yaml", "schema_version: 1\n");
    write(cwd, "package.json", "{\"scripts\":{\"test\":\"vitest\"}}\n");

    const run = runNext(cwd);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("State: onboard-plan-ready");
    expect(run.stdout).toContain("Next: roll init --apply");
  });

  it("points partial and old Roll layouts to repair or migration", () => {
    const partial = project();
    mkdir(partial, ".roll");
    write(partial, ".roll/backlog.md", "# Backlog\n");

    const legacy = project();
    write(legacy, "BACKLOG.md", "# Old Roll backlog\n");

    expect(runNext(partial).stdout).toContain("Next: roll init --repair");
    expect(runNext(legacy).stdout).toContain("Next: npx @seanyao/roll@2 migrate --dry-run");
  });

  it("picks the first executable Todo item in a Roll-ready backlog", () => {
    const cwd = project();
    writeReadyBacklog(cwd, [
      "| [US-DONE](.roll/features/app/US-DONE/spec.md) | Done thing | ✅ Done |",
      "| [FIX-ONE](.roll/features/app/FIX-ONE/spec.md) | Fix first | 📋 Todo |",
      "| [US-TWO](.roll/features/app/US-TWO/spec.md) | Ship second | 📋 Todo |",
    ]);

    const run = runNext(cwd);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("State: roll-ready");
    expect(run.stdout).toContain("Next: roll loop go");
    expect(run.stdout).toContain("Story: FIX-ONE — Fix first");
  });

  it("fails loud with one owner action when Roll-ready has no actionable Todo", () => {
    const cwd = project();
    writeReadyBacklog(cwd, [
      "| [US-HOLD](.roll/features/app/US-HOLD/spec.md) | Parked | 🚫 Hold |",
      "| [US-DONE](.roll/features/app/US-DONE/spec.md) | Done | ✅ Done |",
    ]);

    const run = runNext(cwd);

    expect(run.status).toBe(0);
    expect(run.stdout).toMatchInlineSnapshot(`
      "roll next
      State: roll-ready
      Missing fact: no actionable 📋 Todo row in .roll/backlog.md
      Next: roll status
      Why: Backlog exists, but every row is done, in progress, or on hold.
      "
    `);
  });

  it("prints the ambiguity reason and one owner action", () => {
    const cwd = project();
    write(cwd, "README.md", "# Hi\n");

    const run = runNext(cwd);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("State: ambiguous");
    expect(run.stdout).toContain("Missing fact: README.md exists but has no project intent");
    expect(run.stdout).toContain("Next: roll init");
  });

  it("fails loud on unknown arguments", () => {
    const cwd = project();
    const run = runNext(cwd, ["bogus"]);

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("Usage: roll next");
  });

  it("is read-only for every inspected project state", () => {
    const cwd = project();
    write(cwd, "docs/PRD.md", "# Radar\n\nA product requirements document for an app.\n");
    const before = tree(cwd);

    const run = runNext(cwd);

    expect(run.status).toBe(0);
    expect(tree(cwd)).toEqual(before);
  });

  it("renders the hidden init journey attest smoke without mutating the current project", () => {
    const cwd = project();
    write(cwd, "keep.txt", "unchanged\n");
    const before = tree(cwd);

    const run = runNext(cwd, ["--attest-smoke", "init-journey"]);

    expect(run.status).toBe(0);
    expect(tree(cwd)).toEqual(before);
    expect(scrub(run.stdout)).toMatchInlineSnapshot(`
      "roll next attest smoke: init-journey
      workspace: <journey-workspace>

      [prd-only]
      roll next
      State: prd-only
      Next: roll design --from-file docs/PRD.md
      Why: Product or requirements documents found without source/manifests.

      [codebase-onboard]
      roll next
      State: onboard-plan-ready
      Next: roll init --apply
      Why: .roll/onboard-plan.yaml exists and has not been applied yet.

      [partial-roll]
      roll next
      State: roll-partial
      Next: roll init --repair
      Why: Roll markers are present but incomplete; repair before scaffolding.

      [old-roll-layout]
      roll next
      State: roll-legacy-layout
      Next: npx @seanyao/roll@2 migrate --dry-run
      Why: Old Roll layout marker(s): BACKLOG.md.

      [roll-ready]
      roll next
      State: roll-ready
      Next: roll loop go
      Story: US-NEXT — Ship the next useful slice
      Why: 1 actionable Todo row found in .roll/backlog.md.

      cleanup: removed <journey-workspace>
      "
    `);
  });
});
