/**
 * Exec-wiring smoke test for the Tmux module (US-INFRA-005): a FAKE `tmux` shim
 * on PATH records each wrapper's exact argv so we prove byte-parity vs the cited
 * bin/roll invocation flags. NO real tmux server. (Mirrors the fabricated-binary
 * pattern from packages/cli/test/agent-list.difftest.test.ts.)
 */
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hasClients,
  hasSession,
  killSession,
  listSessions,
  newSession,
  pipePane,
  sendInterrupt,
  sendKeysEnter,
  tmuxAvailable,
} from "../src/tmux.js";

const dirs: string[] = [];
let fakeBin = "";
let log = "";
let savePATH = "";

function readCalls(): string[][] {
  return readFileSync(log, "utf8")
    .split("---\n")
    .filter((s) => s.trim() !== "")
    .map((s) => s.split("\n").filter((t) => t !== ""));
}

beforeAll(() => {
  fakeBin = mkdtempSync(join(tmpdir(), "roll-tmux-bin-"));
  dirs.push(fakeBin);
  log = join(fakeBin, "argv.log");
  writeFileSync(log, "");
  // fake tmux: log argv; route a couple of read commands to fabricated stdout.
  const script = `#!/bin/bash
printf '%s\\n' "$@" >> "${log}"
printf -- '---\\n' >> "${log}"
case "$1" in
  -V) echo "tmux 3.4 (fake)" ;;
  has-session) exit 0 ;;
  list-sessions) printf 'roll-loop-a\\nroll-peer-x-y\\n' ;;
  list-clients) printf '/dev/ttys001: ...\\n' ;;
  *) exit 0 ;;
esac
`;
  const p = join(fakeBin, "tmux");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  savePATH = process.env["PATH"] ?? "";
  process.env["PATH"] = `${fakeBin}:${savePATH}`;
});

afterAll(() => {
  process.env["PATH"] = savePATH;
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

describe("tmux exec wiring: argv byte-exact vs oracle flags", () => {
  it("tmuxAvailable → true via -V probe", async () => {
    expect(await tmuxAvailable()).toBe(true);
  });

  it("hasSession → `has-session -t <name>` (bin/roll 9506)", async () => {
    writeFileSync(log, "");
    expect(await hasSession("roll-loop-a")).toBe(true);
    expect(readCalls()[0]).toEqual(["has-session", "-t", "roll-loop-a"]);
  });

  it("newSession with command → `-d -s <n> -x 200 -y 50 <cmd>` (bin/roll 9533)", async () => {
    writeFileSync(log, "");
    await newSession("roll-loop-a", 'bash "/inner.sh"');
    expect(readCalls()[0]).toEqual([
      "new-session", "-d", "-s", "roll-loop-a", "-x", "200", "-y", "50", 'bash "/inner.sh"',
    ]);
  });

  it("newSession without command → no trailing cmd arg (bin/roll 4206)", async () => {
    writeFileSync(log, "");
    await newSession("roll-peer-x-y");
    expect(readCalls()[0]).toEqual([
      "new-session", "-d", "-s", "roll-peer-x-y", "-x", "200", "-y", "50",
    ]);
  });

  it("sendKeysEnter → `send-keys -t <n>:0 <keys> Enter` (bin/roll 3974)", async () => {
    writeFileSync(log, "");
    await sendKeysEnter("roll-peer-x-y", "bash /tmp/inner.sh; rm -f /tmp/inner.sh");
    expect(readCalls()[0]).toEqual([
      "send-keys", "-t", "roll-peer-x-y:0", "bash /tmp/inner.sh; rm -f /tmp/inner.sh", "Enter",
    ]);
  });

  it("sendInterrupt → `send-keys -t <n>:0 C-c` (bin/roll 3987)", async () => {
    writeFileSync(log, "");
    await sendInterrupt("roll-peer-x-y");
    expect(readCalls()[0]).toEqual(["send-keys", "-t", "roll-peer-x-y:0", "C-c"]);
  });

  it("killSession → `kill-session -t <name>` (bin/roll 9575)", async () => {
    writeFileSync(log, "");
    await killSession("roll-loop-a");
    expect(readCalls()[0]).toEqual(["kill-session", "-t", "roll-loop-a"]);
  });

  it("listSessions → `list-sessions -F '#{session_name}'` + splits (bin/roll 9513)", async () => {
    writeFileSync(log, "");
    expect(await listSessions()).toEqual(["roll-loop-a", "roll-peer-x-y"]);
    expect(readCalls()[0]).toEqual(["list-sessions", "-F", "#{session_name}"]);
  });

  it("hasClients → non-empty list-clients output ⇒ true (bin/roll 4208)", async () => {
    writeFileSync(log, "");
    expect(await hasClients("roll-peer-x-y")).toBe(true);
    expect(readCalls()[0]).toEqual(["list-clients", "-t", "roll-peer-x-y"]);
  });

  it("pipePane → `pipe-pane -t <n> <shell-cmd>` (bin/roll 9537)", async () => {
    writeFileSync(log, "");
    await pipePane("roll-loop-a", 'cat >> "/raw.log"');
    expect(readCalls()[0]).toEqual(["pipe-pane", "-t", "roll-loop-a", 'cat >> "/raw.log"']);
  });
});
