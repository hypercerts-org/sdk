import type { TidString } from "@atproto/lex";

// Generated in-house rather than imported: `@atproto/common-web` exposes `TID` only from its root
// entry, which also loads Zod, and `@atcute/tid`'s `@atcute/time-ms` dependency reads
// `/usr/bin/ldd` and loads a native add-on on import under Node. This follows `@atcute/tid`'s
// algorithm, and tid.test.ts covers the same cases as its suite.

// base32-sortable, the alphabet atproto TIDs are written in.
const ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

// The last timestamp handed out and the clock reading it was based on, in microseconds.
let lastTimestamp = 0n;
let lastClock = 0n;

/**
 * Allocates a record key for a new record: a TID (13 characters, sortable by creation time).
 *
 * Internal. The layout is the one atproto defines: a zero bit, 53 bits of microseconds since the
 * Unix epoch and a 10-bit clock identifier. Follows `@atcute/tid`: when calls outpace the clock the
 * timestamp is bumped, so a burst never reuses a timestamp; when the clock is corrected backwards
 * the timestamp follows it, but never back into timestamps a burst already handed out. Keys are
 * therefore not always increasing. The clock identifier is random per key, which keeps keys unique
 * after the clock moves back.
 */
export function nextTid(): TidString {
  const clock = BigInt(Date.now()) * 1000n;
  // Follow the clock when it moves on or is corrected backwards; otherwise bump past the last key.
  const timestamp = clock > lastTimestamp || clock < lastClock ? clock : lastTimestamp + 1n;
  lastClock = clock;
  lastTimestamp = timestamp;
  return encodeTid(timestamp, randomClockId());
}

/** Writes a timestamp (microseconds) and clock identifier (0–1023) as a TID. */
function encodeTid(timestamp: bigint, clockId: number): TidString {
  const value = (timestamp << 10n) | BigInt(clockId);
  let tid = "";
  for (let shift = 60n; shift >= 0n; shift -= 5n) {
    tid += ALPHABET[Number((value >> shift) & 31n)];
  }
  return tid as TidString;
}

function randomClockId(): number {
  return (crypto.getRandomValues(new Uint16Array(1))[0] ?? 0) & 0x3ff;
}
