/**
 * US-OBS-021 AC6 — Auth provider seam for transport abstraction.
 *
 * The read-channel auth is structurally separate from any future write/control
 * channel. localhost-bind uses NoAuth by default; network-bind will use
 * BearerTokenAuth in the future.
 */

/** Auth provider interface: validate an incoming WebSocket upgrade request. */
export interface AuthProvider {
  /** Returns true if the request is authorized. */
  authorize(req: { headers: Record<string, string> }): boolean;
}

/** Default: no authentication (localhost-bind). */
export class NoAuthProvider implements AuthProvider {
  authorize(_req: { headers: Record<string, string> }): boolean {
    return true;
  }
}

/** Future: Bearer token authentication (network-bind). */
export class BearerTokenAuthProvider implements AuthProvider {
  constructor(private readonly token: string) {}

  authorize(req: { headers: Record<string, string> }): boolean {
    const auth = req.headers["authorization"] ?? "";
    // Case-insensitive "Bearer " prefix match per RFC 6750.
    if (!auth.startsWith("Bearer ") && !auth.startsWith("bearer ")) return false;
    const supplied = auth.slice(7);
    return supplied === this.token;
  }
}
