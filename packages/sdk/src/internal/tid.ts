import type { TidString } from "@atproto/lex";

// base32-sortable, the alphabet atproto TIDs are written in.
const ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

let lastMicros = 0n;
let clockId: bigint | undefined;

/**
 * Allocates a record key for a new record: a TID (13 characters, sortable by creation time).
 *
 * Internal. The layout is the one atproto defines: a zero bit, 53 bits of microseconds since the
 * Unix epoch and a 10-bit clock identifier that is random per JavaScript realm. Keys are unique
 * and increasing within the realm, also across concurrent calls, because the timestamp is bumped
 * when the clock has not moved on since the previous key.
 */
export function nextTid(): TidString {
  clockId ??= BigInt(crypto.getRandomValues(new Uint16Array(1))[0] ?? 0) & 0x3ffn;
  const now = BigInt(Date.now()) * 1000n;
  lastMicros = now > lastMicros ? now : lastMicros + 1n;
  const value = (lastMicros << 10n) | clockId;
  let tid = "";
  for (let shift = 60n; shift >= 0n; shift -= 5n) {
    tid += ALPHABET[Number((value >> shift) & 31n)];
  }
  return tid as TidString;
}
