/**
 * US-ATTEST-012 — secret/PII redaction red line. Evidence text that names a
 * token / Authorization header / private key / email is masked BEFORE it can
 * land in an acceptance report, and the hit is reported (留痕, never silent).
 */
import { describe, expect, it } from "vitest";
import { containsSecret, redactSecrets } from "../src/redact.js";

describe("redactSecrets — masks and traces secrets", () => {
  it("masks Bearer / Authorization tokens", () => {
    const r = redactSecrets("Authorization: Bearer sk-abc123DEADBEEFtokenvalue99");
    expect(r.redacted).not.toContain("sk-abc123DEADBEEFtokenvalue99");
    expect(r.redacted).toContain("«REDACTED");
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("masks github tokens (ghp_/github_pat_) and OpenAI-style sk- keys", () => {
    const r = redactSecrets("token=ghp_0123456789abcdefghijklmnopqrstuvwxyz and key sk-ABCDEFGHIJKLMNOPQRSTU0");
    expect(r.redacted).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyz");
    expect(r.redacted).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTU0");
    expect(r.hits).toContain("github-token");
  });

  it("masks PEM private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const r = redactSecrets(`leaked:\n${pem}\n`);
    expect(r.redacted).not.toContain("MIIEpAIBAAKCAQEA");
    expect(r.hits).toContain("private-key");
  });

  it("masks email addresses (PII)", () => {
    const r = redactSecrets("contact sean.dlut@gmail.com for access");
    expect(r.redacted).not.toContain("sean.dlut@gmail.com");
    expect(r.hits).toContain("email");
  });

  it("clean text is untouched and reports no hits", () => {
    const clean = "✓ 8 passed\nTCR commit landed green\n";
    const r = redactSecrets(clean);
    expect(r.redacted).toBe(clean);
    expect(r.hits).toEqual([]);
  });

  it("containsSecret is a fast boolean probe (used to REJECT screenshot commands)", () => {
    expect(containsSecret("roll attest FIX-300")).toBe(false);
    expect(containsSecret("curl -H 'Authorization: Bearer ghp_0123456789abcdefghijklmnopqrstuvwxyz'")).toBe(true);
  });
});
