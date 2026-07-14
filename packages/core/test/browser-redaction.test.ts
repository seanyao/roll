import { describe, expect, it } from "vitest";
import { persistDiagnostic } from "../src/browser-operations/redaction.js";

describe("US-BROW-005 — diagnostic redaction", () => {
  it("redacts credentials and stores bounded untrusted diagnostic text", () => {
    const result = persistDiagnostic({
      artifactId: "diag-1",
      kind: "console-summary",
      text: [
        "Cookie: session=secret-cookie",
        "Authorization: Bearer super-secret",
        "Set-Cookie: sid=also-secret",
        "password=hunter2&token=api-token",
        "jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature",
      ].join("\n"),
    });

    expect(result.kind).toBe("stored");
    if (result.kind !== "stored") return;

    expect(result.artifact.untrusted).toBe(true);
    expect(result.artifact.diagnosticOnly).toBe(true);
    expect(result.text).not.toContain("secret");
    expect(result.text).not.toContain("hunter2");
    expect(result.text).not.toContain("eyJhbGci");
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(4096);
  });

  it("drops the artifact and records a classified failure when redaction fails", () => {
    const result = persistDiagnostic(
      { artifactId: "diag-2", kind: "console-summary", text: "Authorization: Bearer secret" },
      () => {
        throw new Error("redactor unavailable");
      },
    );

    expect(result).toEqual({ kind: "dropped", failure: "redaction_failed" });
  });
});
