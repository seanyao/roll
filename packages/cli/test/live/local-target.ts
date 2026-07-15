/**
 * US-BROW-020 — hermetic local HTTP target for the live managed-lane suite.
 *
 * A tiny loopback HTTP server that serves everything the live suite needs to
 * exercise real diagnostics WITHOUT a single external network request:
 *   - `/`          an HTML page that logs to the console and pulls one
 *                  same-origin subresource (so `console` and `network`
 *                  summaries have real signal).
 *   - `/app.js`    the script that emits the console line.
 *   - `/data.json` the same-origin subresource (network summary signal).
 *   - `/redirect`  a 302 to an off-allowlist origin, to prove the managed lane
 *                  denies the final origin BEFORE collecting content.
 *   - `/popup`     a page that tries to `window.open` a cross-origin popup.
 *
 * The server binds to 127.0.0.1 on an ephemeral port and never reaches out.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface LocalTarget {
  /** e.g. http://127.0.0.1:53124 */
  origin: string;
  /** The main page URL. */
  url: string;
  /** A 302 that points at `offAllowlistOrigin` (used to prove redirect denial). */
  redirectUrl: string;
  /** The origin the redirect points to — deliberately NOT in the allowlist. */
  offAllowlistOrigin: string;
  /** Requests observed by the server, for hermeticity assertions. */
  requests: string[];
  close: () => Promise<void>;
}

const PAGE_HTML = (origin: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>roll live target</title></head>
<body>
  <h1 id="marker">roll-live-target</h1>
  <img alt="pixel" src="${origin}/pixel.png" width="1" height="1">
  <script src="${origin}/app.js"></script>
</body></html>`;

const APP_JS = `console.log("roll-live: page ready");
fetch("/data.json").then(r => r.json()).then(d => console.log("roll-live: data", d.ok));`;

const POPUP_HTML = (off: string): string => `<!doctype html>
<html><body><script>window.open("${off}/", "_blank");</script></body></html>`;

/**
 * Start the hermetic local target.
 *
 * `offAllowlistOrigin` defaults to a reserved-TEST loopback address that is
 * deliberately never added to the suite's allowlist, so a redirect/popup to it
 * must be denied.
 */
export async function startLocalTarget(
  offAllowlistOrigin = "http://127.0.0.1:1",
): Promise<LocalTarget> {
  const requests: string[] = [];

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    requests.push(path);

    // Loopback-only guard: never serve if a non-loopback Host header appears.
    switch (path) {
      case "/":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE_HTML(originOf(server)));
        return;
      case "/app.js":
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(APP_JS);
        return;
      case "/data.json":
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      case "/pixel.png":
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      case "/redirect":
        res.writeHead(302, { location: `${offAllowlistOrigin}/` });
        res.end();
        return;
      case "/popup":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(POPUP_HTML(offAllowlistOrigin));
        return;
      default:
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = originOf(server);

  return {
    origin,
    url: `${origin}/`,
    redirectUrl: `${origin}/redirect`,
    offAllowlistOrigin,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function originOf(server: Server): string {
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}
