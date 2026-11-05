import { l } from "@atproto/lex";

/**
 * An object schema that also rejects properties it does not list, so a misspelled optional field
 * is an error instead of being silently ignored (or written into the record).
 *
 * Internal. Used for the SDK's input shapes, never for records: records are open objects.
 */
export function strictObject<const TShape extends Record<string, l.Validator>>(shape: TShape) {
  const known = new Set(Object.keys(shape));
  return l.refine(l.object(shape), {
    check: (value: object) => Object.keys(value).every((key) => known.has(key)),
    message: `has a field the SDK does not know. Allowed fields: ${[...known].join(", ")}`,
  });
}

/** A `Blob` (or `File`) to upload, or a URL string to store as it is. */
export const blobOrUrl = l.custom<Blob | string>(
  (value): value is Blob | string => typeof value === "string" || isBlob(value),
  "must be a Blob or File to upload, or a URL string to store as it is",
);

// By tag, not `instanceof`, so a Blob from another realm (an iframe, jsdom) is accepted, as in
// `uploadBlob`.
export function isBlob(value: unknown): value is Blob {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Blob]" || tag === "[object File]";
}

/** Whether `end` is before `start`. Unparseable dates are not judged here: the lexicon rejects them. */
export function endsBeforeStart(range: {
  startDate?: string | undefined;
  endDate?: string | undefined;
}): boolean {
  if (range.startDate === undefined || range.endDate === undefined) return false;
  return Date.parse(range.endDate) < Date.parse(range.startDate);
}

/** Refinement for inputs with `startDate` and `endDate`. */
export const dateRange = {
  check: (range: { startDate?: string | undefined; endDate?: string | undefined }) =>
    !endsBeforeStart(range),
  message: "has an endDate before its startDate",
};

/** Types a record's optional fields as absent rather than `undefined`, which the lexicon types require. */
export type Compacted<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Drops properties whose value is `undefined`, so they are not part of the record that is hashed and sent. */
export function compact<T extends object>(value: T): Compacted<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Compacted<T>;
}

/** A `Blob` or `File` to upload. */
export const blob = l.custom<Blob>(isBlob, "must be a Blob or File");

/** An optional string. The lexicon checks its length and format. */
export const optionalText = l.optional(l.string());

/** An optional file to upload or URL to keep; see `mediaTransform`. */
export const optionalMedia = l.optional(blobOrUrl);
