/**
 * US-OBS-022 — @roll/web package entry point.
 *
 * Exports:
 * - ConsoleApp: renders the live Now tab from TruthSnapshot frames
 * - FrameHandler: WebSocket client for the daemon
 * - C, MONO: design tokens matching the static truth-console.ts
 */

export { ConsoleApp } from "./console-app.js";
export type { LivenessState } from "./console-app.js";
export { FrameHandler } from "./frame-handler.js";
export type {
  FrameHandlerCallbacks,
  FrameHandlerOptions,
} from "./frame-handler.js";
export { C, MONO } from "./colors.js";
