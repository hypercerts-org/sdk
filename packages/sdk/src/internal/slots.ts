import { l, type NsidString } from "@atproto/lex";
import { type BuildContext, parseInput } from "./build-context.js";
import { describeValue } from "./describe.js";
import type { PreparedRecord } from "./prepare-record.js";
import { buildRecord, type RecordKind } from "./record-kind.js";
import { resolveRecordRef, type StrongRef } from "./resolve-record-ref.js";

/**
 * What the caller asked for in one place that holds a supporting record:
 * - `existing`: a reference to a record that already exists, never rewritten.
 * - `inline`: a value the Activity's lexicon stores directly instead of a record.
 * - `new`: a record to create, with its input already validated.
 */
export type SlotChoice =
  | { readonly kind: "existing"; readonly uri: string }
  | { readonly kind: "inline"; readonly value: string }
  | { readonly kind: "new"; readonly prepare: () => Promise<PreparedRecord> };

/** A place in an Activity that holds a supporting record, with the choice made for it. */
export interface Slot {
  readonly collection: NsidString;
  readonly field: string;
  readonly choice: SlotChoice;
}

const isInputObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads one tagged choice from the caller's data without sending any request.
 *
 * Internal. `{ uri }` means an existing record and `{ inline }` an inline value; any other
 * object is the data of a new record. `uri` and `inline` are never mixed with record fields,
 * because it would be unclear whether the caller wants to create or to reuse.
 *
 * Throws TypeError, naming `field`, for anything that is not one of the three, for a URI of
 * another record type, and for any problem in new record data.
 */
export function toSlot<T extends { createdAt?: string | undefined }>(
  build: BuildContext,
  field: string,
  value: unknown,
  kind: RecordKind<T>,
  inline: boolean,
): Slot {
  const collection = kind.schema.$type;
  const expected = `the fields of a new ${collection} record, { uri } of an existing one${inline ? ", or { inline }" : ""}`;
  if (!isInputObject(value)) {
    throw new TypeError(
      `${build.operation}: ${field} must be ${expected}, but received ${describeValue(value)}.`,
    );
  }
  return { collection, field, choice: choose(build, field, value, kind, inline, expected) };
}

function choose<T extends { createdAt?: string | undefined }>(
  build: BuildContext,
  field: string,
  value: object,
  kind: RecordKind<T>,
  inline: boolean,
  expected: string,
): SlotChoice {
  const tag = slotTag(value);
  if (tag === undefined) {
    const input = parseInput(build, field, kind.input, value);
    return { kind: "new", prepare: () => buildRecord(kind, build, input, field) };
  }
  if (Object.keys(value).length > 1) {
    throw new TypeError(
      `${build.operation}: ${field} combines \`${tag}\` with other fields. Pass ${expected}, not a mix: \`uri\` reuses an existing record and the record's own fields create a new one.`,
    );
  }
  if (tag === "inline") {
    if (!inline) {
      throw new TypeError(
        `${build.operation}: ${field} does not accept { inline }: this field holds a reference to a ${kind.schema.$type} record. Pass ${expected}.`,
      );
    }
    return { kind: "inline", value: parseInput(build, field, inlineValue, value).inline };
  }
  return existing(build, field, value, kind.schema.$type);
}

function slotTag(value: object): "inline" | "uri" | undefined {
  if ("inline" in value) return "inline";
  if ("uri" in value) return "uri";
  return undefined;
}

const inlineValue = l.object({ inline: l.string() });
const existingRecord = l.object({ uri: l.string({ format: "at-uri" }) });

function existing(
  build: BuildContext,
  field: string,
  value: object,
  collection: NsidString,
): SlotChoice {
  const { uri } = parseInput(build, field, existingRecord, value);
  // `at-uri` alone also accepts other record types, handle authorities and URIs without a key. The
  // type is checked here so a wrong one fails before any request; `resolveRecordRef` rejects the
  // rest.
  const actual = uri.split("/")[3];
  if (actual !== collection) {
    const target = actual === undefined ? "something that is not a record" : `a ${actual} record`;
    throw new TypeError(
      `${build.operation}: ${field} points at ${target}, but this field holds ${collection}: ${uri}. Expected at://<did>/${collection}/<rkey>.`,
    );
  }
  return { kind: "existing", uri };
}

/**
 * Reads every `existing` slot from the PDS that hosts it, in parallel. Done before anything is
 * uploaded or written, so an unresolvable URI fails without side effects.
 *
 * Throws what `resolveRecordRef` throws.
 */
export function resolveExisting(
  build: BuildContext,
  slots: readonly Slot[],
): Promise<Map<Slot, StrongRef>> {
  return settle(slots, ({ choice }) =>
    choice.kind === "existing" ? resolveRecordRef(build.context, choice.uri) : undefined,
  );
}

/** Builds every `new` slot's record (uploads included) in parallel. */
export function prepareNew(slots: readonly Slot[]): Promise<Map<Slot, PreparedRecord>> {
  return settle(slots, ({ choice }) => (choice.kind === "new" ? choice.prepare() : undefined));
}

// Runs `run` for every slot at once and keeps the results of the slots it did something for.
async function settle<T>(
  slots: readonly Slot[],
  run: (slot: Slot) => Promise<T> | undefined,
): Promise<Map<Slot, T>> {
  const settled = await Promise.all(
    slots.map(async (slot) => {
      const result = await run(slot);
      return result === undefined ? undefined : ([slot, result] as const);
    }),
  );
  return new Map(settled.filter((entry) => entry !== undefined));
}
