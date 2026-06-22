import { describe, it, expect } from "vitest";
import { NoAuthProvider, BearerTokenAuthProvider } from "../src/transport-auth.js";

describe("NoAuthProvider", () => {
  it("authorizes any request", () => {
    const auth = new NoAuthProvider();
    expect(auth.authorize({ headers: {} })).toBe(true);
    expect(auth.authorize({ headers: { authorization: "Bearer secret" } })).toBe(true);
    expect(auth.authorize({ headers: { "x-custom": "foo" } })).toBe(true);
  });
});

describe("BearerTokenAuthProvider", () => {
  const token = "my-secret-token";
  const auth = new BearerTokenAuthProvider(token);

  it("authorizes with correct Bearer token", () => {
    expect(auth.authorize({ headers: { authorization: "Bearer my-secret-token" } })).toBe(true);
  });

  it("authorizes with lowercase bearer prefix", () => {
    expect(auth.authorize({ headers: { authorization: "bearer my-secret-token" } })).toBe(true);
  });

  it("rejects wrong token", () => {
    expect(auth.authorize({ headers: { authorization: "Bearer wrong-token" } })).toBe(false);
  });

  it("rejects missing authorization header", () => {
    expect(auth.authorize({ headers: {} })).toBe(false);
  });

  it("rejects non-Bearer auth scheme", () => {
    expect(auth.authorize({ headers: { authorization: "Basic my-secret-token" } })).toBe(false);
  });

  it("rejects empty token", () => {
    const empty = new BearerTokenAuthProvider("");
    expect(empty.authorize({ headers: { authorization: "Bearer " } })).toBe(true);
    expect(empty.authorize({ headers: { authorization: "Bearer x" } })).toBe(false);
  });
});
