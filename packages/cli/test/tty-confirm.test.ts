import { describe, expect, it } from "vitest";
import { isAffirmative, readLineSyncFromFd, type ByteReader } from "../src/lib/tty-confirm.js";

describe("tty-confirm", () => {
  it("FIX-1029: EAGAIN is retried instead of being treated as empty input", () => {
    const bytes = Buffer.from(" yes \n", "utf8");
    let attempts = 0;
    let offset = 0;
    const readByte: ByteReader = (_fd, buf) => {
      attempts++;
      if (attempts <= 2) {
        const err = new Error("not ready") as NodeJS.ErrnoException;
        err.code = "EAGAIN";
        throw err;
      }
      if (offset >= bytes.length) return 0;
      buf[0] = bytes[offset] ?? 0;
      offset++;
      return 1;
    };

    expect(readLineSyncFromFd(0, readByte)).toBe(" yes ");
    expect(attempts).toBeGreaterThan(2);
  });

  it("accepts y/yes with surrounding whitespace and rejects empty answers", () => {
    expect(isAffirmative("y")).toBe(true);
    expect(isAffirmative(" YES ")).toBe(true);
    expect(isAffirmative("")).toBe(false);
    expect(isAffirmative("no")).toBe(false);
  });
});
