/**
 * US-ATTEST-003 — evidence collector: sweep the HARD, machine-checkable facts
 * a finished story left behind and freeze them into `evidence.json`.
 *
 * roll philosophy split (design D7): the AI writes INTENT (which evidence backs
 * which AC — that's the attest skill's job); this module grabs FACTS only:
 *   - TCR commits naming the story (`git log --grep`, subject filter)
 *   - the latest CI run (`gh run list`, absent-gh tolerated → available:false)
 *   - an optional deploy URL HEAD probe (status code only, 5s budget, no body)
 *   - the `.roll/last-test-pass` proof (presence + age)
 *   - already-captured artifacts in the run dir (screenshots/*.png,
 *     evidence/*.txt — produced by the 004 dispatcher / Gate session)
 *
 * Every external touch goes through an injectable {@link EvidenceRun} so tests
 * fake git/gh/curl with recorders — no network, no real repo needed. The
 * collector NEVER throws: a failed probe degrades to its empty/absent shape
 * (the report renders what exists; missing evidence downgrades the AC to
 * Claimed — that's the report's red line, not an exception path).
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gh, ghAvailable } from "./github.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Result shape every runner returns (mirrors GitResult/GhResult). */
export interface RunOut {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable process seam: tool ∈ git|gh|curl. */
export type EvidenceRun = (tool: "git" | "gh" | "curl", argv: readonly string[], cwd?: string) => Promise<RunOut>;

const defaultRun: EvidenceRun = async (tool, argv, cwd) => {
  if (tool === "gh") return gh(argv);
  try {
    const { stdout, stderr } = await execFileAsync(tool, [...argv], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      ...(cwd !== undefined ? { cwd } : {}),
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof err.code === "number" ? err.code : 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
};

export interface TcrCommit {
  hash: string;
  subject: string;
}

export interface EvidenceManifest {
  story_id: string;
  collected_at: string;
  tcr_commits: TcrCommit[];
  ci: { available: boolean; url: string; conclusion: string };
  deploy: { url: string; status: number; ok: boolean } | null;
  test_pass: { present: boolean; age_seconds: number };
  screenshots: string[];
  texts: string[];
  captures: CaptureFact[];
  capture_command: CaptureCommandFact | null;
}

export interface CaptureFact {
  kind: string;
  out: string;
  taken: boolean;
  skipped?: string;
  failed?: boolean;
  error?: string;
}

export interface CaptureCommandFact {
  command: string;
  wrappedCommand: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
}

export interface CollectOptions {
  storyId: string;
  /** Project root (git cwd + .roll/last-test-pass location). */
  projectPath: string;
  /** This attest run's dir — `screenshots/` + `evidence/` live under it. */
  runDir: string;
  /** Optional deploy URL → one HEAD probe. */
  deployUrl?: string;
  /** Clock (ISO string), injected so manifests are reproducible in tests. */
  now: () => string;
  run?: EvidenceRun;
  ghProbe?: () => Promise<boolean>;
  captures?: readonly CaptureFact[];
  captureCommand?: CaptureCommandFact | null;
}

export interface EvidenceFrame {
  runDir: string;
  evidenceDir: string;
  screenshotsDir: string;
}

export interface OpenEvidenceFrameOptions {
  /** Absolute or project-relative story run dir, e.g. `.roll/features/<epic>/<ID>/<run-id>`. */
  runDir: string;
}

/**
 * US-EVID-001 — open the cycle evidence frame before the agent runs.
 * Idempotent by design: resuming a PAUSEd/crashed cycle reuses the same frame
 * and never clears evidence already deposited by earlier phases.
 */
export function openEvidenceFrame(opts: OpenEvidenceFrameOptions): EvidenceFrame {
  const frame = {
    runDir: opts.runDir,
    evidenceDir: join(opts.runDir, "evidence"),
    screenshotsDir: join(opts.runDir, "screenshots"),
  };
  mkdirSync(frame.evidenceDir, { recursive: true });
  mkdirSync(frame.screenshotsDir, { recursive: true });
  return frame;
}

/** Sweep all sources; never throws — failures degrade to absent shapes. */
export async function collectEvidence(opts: CollectOptions): Promise<EvidenceManifest> {
  const run = opts.run ?? defaultRun;
  const ghOk = await (opts.ghProbe ?? ghAvailable)().catch(() => false);

  // 1. TCR commits naming the story (subject filter on top of the tcr: grep —
  //    --grep matches either pattern, so the storyId filter is done here).
  const tcr: TcrCommit[] = [];
  const log = await run(
    "git",
    ["log", "--format=%H%x09%s", "--grep=^tcr:", "-n", "200"],
    opts.projectPath,
  ).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (log.code === 0) {
    for (const line of log.stdout.split("\n")) {
      const [hash, subject = ""] = line.split("\t");
      if (hash !== undefined && hash !== "" && subject.includes(opts.storyId)) {
        tcr.push({ hash, subject });
      }
    }
  }

  // 2. Latest CI run (best-effort; gh-missing is a first-class shape).
  let ci = { available: false, url: "", conclusion: "" };
  if (ghOk) {
    const r = await run("gh", ["run", "list", "--limit", "1", "--json", "url,conclusion"], opts.projectPath).catch(
      () => ({ code: 1, stdout: "", stderr: "" }),
    );
    if (r.code === 0) {
      try {
        const arr = JSON.parse(r.stdout) as Array<{ url?: string; conclusion?: string }>;
        const first = arr[0];
        if (first !== undefined) {
          ci = { available: true, url: first.url ?? "", conclusion: first.conclusion ?? "" };
        }
      } catch {
        /* malformed → stays unavailable */
      }
    }
  }

  // 3. Deploy URL HEAD probe (status code only; 5s budget; never throws).
  let deploy: EvidenceManifest["deploy"] = null;
  if (opts.deployUrl !== undefined && opts.deployUrl !== "") {
    const r = await run(
      "curl",
      ["-sI", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", opts.deployUrl],
      opts.projectPath,
    ).catch(() => ({ code: 1, stdout: "000", stderr: "" }));
    const status = Number((r.stdout || "0").trim()) || 0;
    deploy = { url: opts.deployUrl, status, ok: r.code === 0 && status >= 200 && status < 400 };
  }

  // 4. Commit-gate proof.
  let testPass = { present: false, age_seconds: -1 };
  const proof = join(opts.projectPath, ".roll", "last-test-pass");
  if (existsSync(proof)) {
    try {
      const age = Math.max(0, Math.round((Date.parse(opts.now()) - statSync(proof).mtimeMs) / 1000));
      testPass = { present: true, age_seconds: age };
    } catch {
      testPass = { present: true, age_seconds: -1 };
    }
  }

  // 5. Already-captured artifacts in this run dir.
  const listDir = (sub: string, ext: RegExp): string[] => {
    const dir = join(opts.runDir, sub);
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir)
        .filter((f) => ext.test(f))
        .sort()
        .map((f) => `${sub}/${f}`);
    } catch {
      return [];
    }
  };

  return {
    story_id: opts.storyId,
    collected_at: opts.now(),
    tcr_commits: tcr,
    ci,
    deploy,
    test_pass: testPass,
    screenshots: listDir("screenshots", /\.png$/i),
    texts: listDir("evidence", /\.(txt|log)$/i),
    captures: [...(opts.captures ?? [])],
    capture_command: opts.captureCommand ?? null,
  };
}

/** Write `evidence.json` (stable 2-space layout) into the run dir. */
export function writeEvidenceJson(manifest: EvidenceManifest, runDir: string): string {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, "evidence.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return path;
}
