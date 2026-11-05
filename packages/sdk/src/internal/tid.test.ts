import { isTidString } from "@atproto/lex";
import { afterEach, expect, it, vi } from "vitest";
import { nextTid } from "./tid.js";

// Inverse of the TID layout: the 11 leading characters hold the timestamp in microseconds.
function timestampOf(tid: string): number {
  return [...tid.slice(0, 11)].reduce(
    (acc, char) => acc * 32 + "234567abcdefghijklmnopqrstuvwxyz".indexOf(char),
    0,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("encodes the timestamp and clock identifier like other atproto implementations", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1723819911723);
  vi.spyOn(crypto, "getRandomValues").mockImplementationOnce((array) => {
    (array as Uint16Array).set([490]);
    return array;
  });

  // The vector from @atcute/tid's test suite: timestamp 1723819911723000 µs, clock identifier 490.
  expect(nextTid()).toBe("3kztsgrxhzsje");
});

it("bumps the timestamp of a second key in the same millisecond", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-08-16T14:58:10.161Z"));

  // Prefixes from @atcute/tid's test suite: the second call in the same millisecond is bumped.
  expect(nextTid()).toMatch(/^3kztss2uifc/);
  expect(nextTid()).toMatch(/^3kztss2uifd/);
});

it("allocates valid TIDs that never reuse a timestamp, also when calls outpace the clock", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-08-16T15:00:00.000Z"));

  // A millisecond holds 1000 microseconds, so this burst runs 500 ahead of the clock.
  const tids = Array.from({ length: 1500 }, nextTid);
  // The clock now ticks into timestamps the burst already handed out.
  vi.advanceTimersByTime(1);
  tids.push(...Array.from({ length: 1000 }, nextTid));

  expect(tids.every((tid) => isTidString(tid))).toBe(true);
  expect(new Set(tids.map(timestampOf)).size).toBe(tids.length);
});

it("follows the clock when it is corrected backwards", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-08-16T16:00:00.000Z"));
  const before = timestampOf(nextTid());

  const corrected = new Date("2024-08-16T15:30:00.000Z");
  vi.setSystemTime(corrected);
  const after = timestampOf(nextTid());

  expect(after).toBeLessThan(before);
  expect(after).toBe(corrected.getTime() * 1000);
});
