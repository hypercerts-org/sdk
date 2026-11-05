import { isTidString } from "@atproto/lex";
import { expect, it } from "vitest";
import { nextTid } from "./tid.js";

it("allocates valid TIDs that are unique and increase, also within one millisecond", () => {
  const tids = Array.from({ length: 2000 }, nextTid);

  expect(tids.every((tid) => isTidString(tid))).toBe(true);
  expect(new Set(tids).size).toBe(tids.length);
  expect(tids).toEqual([...tids].sort());
});
