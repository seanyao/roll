// Display-time helpers: fixed Asia/Shanghai wall clock (UTC+8, no DST).
export const TZ_OFFSET_MS = 8 * 3600 * 1000;

/** A UTC Date shifted into UTC+8 wall-clock, exposed via getUTC* accessors. */
export function toShanghai(d: Date): Date {
  return new Date(d.getTime() + TZ_OFFSET_MS);
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function shHHMM(d: Date): string {
  const s = toShanghai(d);
  return `${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}`;
}

export function shDayKey(d: Date): string {
  const s = toShanghai(d);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`;
}

export function shYmdHm(d: Date): string {
  const s = toShanghai(d);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}`;
}

/** YYYY-MM-DD shifted by `deltaDays` from a given day key (display TZ). */
export function dayKeyOffset(d: Date, deltaDays: number): string {
  const s = toShanghai(d);
  const shifted = new Date(
    Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + deltaDays),
  );
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}
