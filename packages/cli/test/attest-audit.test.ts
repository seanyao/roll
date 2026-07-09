/**
 * US-EVID-027 — `roll attest audit` also lists existing screenshot_exempt cards
 * (per-card reasons + policy epic-level blanket exemptions), READ-ONLY: it only
 * reports the legacy exemption debt, never retroactively blocks any card.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attestAuditCommand } from "../src/commands/attest-audit.js";

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-evid027-cmd-"));
  const card = (epic: string, id: string, reason?: string): void => {
    const dir = join(root, ".roll", "features", epic, id);
    mkdirSync(dir, { recursive: true });
    const line = reason ? `screenshot_exempt: ${reason}\n` : "";
    writeFileSync(join(dir, "spec.md"), `---\nid: ${id}\ntitle: t\n${line}---\n\n# ${id}\n`, "utf8");
  };
  card("acceptance-evidence", "US-1", "backend; tests are evidence");
  card("acceptance-evidence", "US-2"); // not exempt
  mkdirSync(join(root, ".roll"), { recursive: true });
  writeFileSync(join(root, ".roll", "policy.yaml"), "acceptance:\n  screenshot_exempt_epics: [feedback-truth-alignment]\n", "utf8");
  return root;
}

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => {
    chunks.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  return fn()
    .then((code) => ({ code, out: chunks.join("") }))
    .finally(() => {
      process.stdout.write = real;
    });
}

describe("US-EVID-027 — roll attest audit lists existing exemptions (read-only)", () => {
  it("prints per-card exemptions and the policy blanket-exempt epics", async () => {
    const root = project();
    const { out } = await captureStdout(() => attestAuditCommand([], root));
    expect(out).toContain("acceptance-evidence/US-1");
    expect(out).toContain("feedback-truth-alignment"); // policy blanket epic
    expect(out).not.toContain("US-2"); // a non-exempt card is not listed
  });

  it("--json includes an exemptions block", async () => {
    const root = project();
    const { out } = await captureStdout(() => attestAuditCommand(["--json"], root));
    const parsed = JSON.parse(out) as { exemptions?: { cards?: unknown[]; blanketEpics?: unknown[] } };
    expect(Array.isArray(parsed.exemptions?.cards)).toBe(true);
    expect(parsed.exemptions?.blanketEpics).toContain("feedback-truth-alignment");
  });

  it("READ-ONLY: exemptions never flip the exit code (a clean audit with exemptions still exits 0)", async () => {
    // The project has exempt cards but NO dangling evidence / evidence debt.
    // Exemptions are debt to REPORT, never a block — the exit code must stay 0.
    const root = project();
    const { code } = await captureStdout(() => attestAuditCommand([], root));
    expect(code).toBe(0);
    const { code: jsonCode } = await captureStdout(() => attestAuditCommand(["--json"], root));
    expect(jsonCode).toBe(0);
  });
});
