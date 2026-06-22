/**
 * US-OBS-022 — Browser entry point for the live console.
 *
 * This file is bundled for the browser. It:
 * 1. Opens one WebSocket to the daemon
 * 2. Renders the Now tab from snapshot frames
 * 3. Falls back to static truth.json when the daemon is unreachable
 * 4. Auto-reconnects
 */
import { ConsoleApp } from "./console-app.js";
import { FrameHandler } from "./frame-handler.js";
import type { DossierSnapshotFrame, DossierHeartbeatFrame, TruthSnapshot } from "@roll/spec";

function main(): void {
  const appContainer = document.getElementById("roll-console");
  if (!appContainer) {
    // No container in the HTML shell — the page is likely the static version.
    // Attach to body as a fallback.
    const fallback = document.createElement("div");
    fallback.id = "roll-console";
    document.body.appendChild(fallback);
    return;
  }

  const app = new ConsoleApp(appContainer);

  const handler = new FrameHandler({
    onSnapshot: (frame: DossierSnapshotFrame) => {
      app.renderSnapshot(frame);
    },
    onHeartbeat: (frame: DossierHeartbeatFrame) => {
      app.updateHeartbeat(frame);
    },
    onDegrade: (_reason: string) => {
      // AC3: Try to load the baked truth.json snapshot.
      fetch("../truth.json")
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<TruthSnapshot>;
        })
        .then((snapshot: TruthSnapshot) => {
          app.renderDegraded(snapshot, snapshot.generatedAt);
        })
        .catch(() => {
          // truth.json unavailable — show degraded with empty state.
          app.renderDegraded(
            {
              generatedAt: new Date().toISOString(),
              story: {
                total: 0,
                spectrum: {
                  done: 0,
                  wip: 0,
                  hold: 0,
                  todo: 0,
                  fail: 0,
                  unknown: 0,
                },
                legacy: 0,
              },
            },
            undefined,
          );
        });
    },
    onReconnect: () => {
      // The next snapshot frame will re-render with live data.
    },
  });

  handler.connect();
}

// Run on DOMContentLoaded so the container element exists.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
