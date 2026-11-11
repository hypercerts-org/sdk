import { l } from "@atproto/lex";
import { strictObject } from "../internal/input.js";
import { decimalString } from "./shared.js";

/**
 * An overall score on a numeric scale. All three are decimal strings, for example
 * `{ min: "0", max: "5", value: "3.7" }`.
 */
export interface EvaluationScore {
  /** The lowest value of the scale. At most 50 characters. */
  min: string;
  /** The highest value of the scale, not below `min`. At most 50 characters. */
  max: string;
  /** The score, from `min` to `max` inclusive. At most 50 characters. */
  value: string;
}

/**
 * Orders two decimal strings by value, exactly: no JavaScript number is involved, so `"0.1"` and
 * `"0.10"` are equal and 30-digit values compare correctly. Both must match `decimalString`.
 * Negative when `a < b`, zero when equal, positive when `a > b`.
 */
export function compareDecimals(a: string, b: string): number {
  const [x, y] = [parseDecimal(a), parseDecimal(b)];
  const scale = Math.max(x.fraction.length, y.fraction.length);
  const scaled = ({ negative, whole, fraction }: Decimal) =>
    BigInt(`${negative ? "-" : ""}${whole}${fraction.padEnd(scale, "0")}`);
  const difference = scaled(x) - scaled(y);
  if (difference === 0n) return 0;
  return difference < 0n ? -1 : 1;
}

interface Decimal {
  negative: boolean;
  whole: string;
  fraction: string;
}

function parseDecimal(value: string): Decimal {
  const negative = value.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return { negative, whole, fraction };
}

/** Input schema of an {@link EvaluationScore}: decimal strings with `value` from `min` to `max`. */
export const scoreInput = l.refine(
  strictObject({ min: decimalString, max: decimalString, value: decimalString }),
  {
    check: ({ min, max, value }: EvaluationScore) =>
      compareDecimals(min, value) <= 0 && compareDecimals(value, max) <= 0,
    message: "must have a value from min to max, inclusive",
  },
);
