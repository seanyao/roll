/**
 * US-OBS-024 — daemon lifecycle tests (pid tracking, liveness).
 *
 * Pure function tests; no real process spawn. The CLI daemon test covers the
 * detached child-spawn path with a real Node shim.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  daemonPidPath,
  readDaemonPid,
  writeDaemonPid,
  clearDaemonPid,
  isDaemonRunning,
  type DaemonPidRecord,
} from "../src/daemon-lifecycle.js";
import { type PidAlive } from "../src/process.js";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tmpDir(): string {
  return join(tmpdir(), `roll-infra-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("daemonLifecycle", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = tmpDir();
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ok */ }
  });

  describe("daemonPidPath", () => {
    it("returns .roll/loop/daemon.pid under cwd", () => {
      expect(daemonPidPath(cwd)).toBe(join(cwd, ".roll", "loop", "daemon.pid"));
    });
  });

  describe("readDaemonPid / writeDaemonPid / clearDaemonPid", () => {
    it("read returns null when no file exists", () => {
      expect(readDaemonPid(cwd)).toBeNull();
    });

    it("writes and reads a valid record", () => {
      const record: DaemonPidRecord = { pid: 12345, host: "127.0.0.1", port: 7077, startedAt: 1700000000000 };
      writeDaemonPid(cwd, record);
      const read = readDaemonPid(cwd);
      expect(read).not.toBeNull();
      expect(read!.pid).toBe(12345);
      expect(read!.host).toBe("127.0.0.1");
      expect(read!.port).toBe(7077);
      expect(read!.startedAt).toBe(1700000000000);
    });

    it("clear removes the file", () => {
      writeDaemonPid(cwd, { pid: 1, host: "127.0.0.1", port: 7077, startedAt: 0 });
      clearDaemonPid(cwd);
      expect(readDaemonPid(cwd)).toBeNull();
    });

    it("clear is idempotent (no file → no error)", () => {
      clearDaemonPid(cwd);
      expect(readDaemonPid(cwd)).toBeNull();
    });

    it("write creates parent directories", () => {
      writeDaemonPid(cwd, { pid: 1, host: "127.0.0.1", port: 7077, startedAt: 0 });
      expect(existsSync(daemonPidPath(cwd))).toBe(true);
    });

    it("read returns null for malformed JSON", () => {
      const path = daemonPidPath(cwd);
      mkdirSync(join(cwd, ".roll", "loop"), { recursive: true });
      writeFileSync(path, "not json");
      expect(readDaemonPid(cwd)).toBeNull();
    });

    it("read returns null for JSON with missing fields", () => {
      const path = daemonPidPath(cwd);
      mkdirSync(join(cwd, ".roll", "loop"), { recursive: true });
      writeFileSync(path, JSON.stringify({ pid: 1 }));
      expect(readDaemonPid(cwd)).toBeNull();
    });

    it("read returns null for JSON with wrong types", () => {
      const path = daemonPidPath(cwd);
      mkdirSync(join(cwd, ".roll", "loop"), { recursive: true });
      writeFileSync(path, JSON.stringify({ pid: "abc", host: 123, port: "7077", startedAt: null }));
      expect(readDaemonPid(cwd)).toBeNull();
    });
  });

  describe("isDaemonRunning", () => {
    const yesAlive: PidAlive = () => true;
    const noAlive: PidAlive = () => false;

    it("returns false when no pid record exists", () => {
      expect(isDaemonRunning(cwd, yesAlive)).toBe(false);
    });

    it("returns false when pid record exists but pid is dead", () => {
      writeDaemonPid(cwd, { pid: 99999, host: "127.0.0.1", port: 7077, startedAt: 0 });
      expect(isDaemonRunning(cwd, noAlive)).toBe(false);
    });

    it("returns true when pid record exists and pid is alive", () => {
      writeDaemonPid(cwd, { pid: 99999, host: "127.0.0.1", port: 7077, startedAt: 0 });
      expect(isDaemonRunning(cwd, yesAlive)).toBe(true);
    });
  });
});
