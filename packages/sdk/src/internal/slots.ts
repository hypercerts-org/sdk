import { isDidString, l, type NsidString, type RecordKeyString } from "@atproto/lex";
import * as strongRef from "@hypercerts-org/lexicon/com/atproto/repo/strongRef";
import { type BuildContext, parseInput } from "./build-context.js";
import { describeError, describeValue } from "./describe.js";
import type { PreparedRecord } from "./prepare-record.js";
import { buildRecord, type RecordKind, type ReferenceField, recordKeyOf } from "./record-kind.js";
import { recordExists, resolveRecordRef, type StrongRef } from "./resolve-record-ref.js";
import { RecordAlreadyExistsError } from "./submit-writes.js";

/**
 * Points at a record that already exists, to reuse it as it is.
 *
 * @remarks
 * The record is read to learn its current CID and is never rewritten. It must be a record of the
 * type the field holds (for example `org.hypercerts.claim.rights` for an Activity's `rights`),
 * identified by a DID, not a handle: `at://<did>/<collection>/<rkey>`. It may belong to another
 * account if it is public. Do not combine `uri` with other fields; that would be ambiguous.
 */
export interface ExistingRecord {
  uri: string;
}

/**
 * A record that a call references, with whether this call created it.
 *
 * @remarks
 * `created` is `false` for a record passed as `{ uri }`; its CID is the one read before the write.
 */
export interface SupportingRecordRef extends StrongRef {
  /** `true` when this call created the record, `false` when it reused an existing one. */
  created: boolean;
}

/** The reference a slot has once the reads and the builds are done. */
export type ReferenceOf = (slot: Slot) => StrongRef;

/**
 * A new record to create, with its input already validated and the slots of the records it points
 * at planned.
 */
export interface NewChoice {
  readonly kind: "new";
  /**
   * The record key the input decided (a vocabulary tag's `<category>.<key>`, a profile's `self`),
   * if it did. Such a key can already be taken.
   */
  readonly key: RecordKeyString | undefined;
  /** The slots of the records this one points at, by field. They are prepared before it. */
  readonly references: Readonly<Record<string, Slot | readonly Slot[]>>;
  /** Builds the record once every record it points at has a reference. */
  readonly prepare: (refOf: ReferenceOf) => Promise<PreparedRecord>;
}

/**
 * What the caller asked for in one place that holds a supporting record:
 * - `existing`: a reference to a record that already exists, never rewritten.
 * - `inline`: a value the Activity's lexicon stores directly instead of a record.
 * - `new`: a record to create. See {@link NewChoice}.
 */
export type SlotChoice =
  | { readonly kind: "existing"; readonly uri: string }
  | { readonly kind: "inline"; readonly value: string }
  | NewChoice;

/**
 * A place that holds a supporting record, with the choice made for it. `collection` is the type of
 * record the place holds, or `undefined` for a place that accepts a record of any type.
 */
export interface Slot {
  readonly collection: NsidString | undefined;
  readonly field: string;
  readonly choice: SlotChoice;
}

/** A slot whose record this call creates. */
export interface NewSlot extends Slot {
  readonly collection: NsidString;
  readonly choice: NewChoice;
}

/** Whether `value` is a plain object: not `null`, not an array. */
export const isInputObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a value is `{ uri }` or has a `uri` among other fields, the shape of an existing record. */
export const isExistingRecord = (value: unknown): value is ExistingRecord =>
  isInputObject(value) && "uri" in value;

const isNew = (slot: Slot): slot is NewSlot => slot.choice.kind === "new";

const isSlotList = (target: Slot | readonly Slot[]): target is readonly Slot[] =>
  Array.isArray(target);

/**
 * Reads one tagged choice from the caller's data without sending any request.
 *
 * Internal. `{ uri }` means an existing record and `{ inline }` an inline value; any other
 * object is the data of a new record, whose own references are planned too (see `planNew`).
 * `uri` and `inline` are never mixed with record fields, because it would be unclear whether the
 * caller wants to create or to reuse.
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
  const tag = slotTag(value);
  if (tag === undefined) return planNew(build, field, kind, value);
  assertNotMixed(build, field, value, tag, expected);
  if (tag === "inline") {
    if (!inline) {
      throw new TypeError(
        `${build.operation}: ${field} does not accept { inline }: this field holds a reference to a ${collection} record. Pass ${expected}.`,
      );
    }
    return {
      collection,
      field,
      choice: { kind: "inline", value: parseInput(build, field, inlineValue, value).inline },
    };
  }
  return { collection, field, choice: existing(build, field, value, collection) };
}

/**
 * Reads a field that accepts only an existing record: `{ uri }`. Any record type is accepted,
 * unless `collections` lists the ones that are, in which case the slot's `collection` is the one
 * the URI points at.
 *
 * Throws TypeError, naming `field`, when `value` is not `{ uri }` of a record, or of a record of
 * another type than `collections`.
 */
export function toExistingSlot(build: BuildContext, field: string, value: unknown): Slot;
export function toExistingSlot<TCollection extends NsidString>(
  build: BuildContext,
  field: string,
  value: unknown,
  collections: readonly TCollection[],
): Slot & { readonly collection: TCollection };
export function toExistingSlot(
  build: BuildContext,
  field: string,
  value: unknown,
  collections?: readonly NsidString[],
): Slot {
  const expected = "{ uri } of an existing record";
  if (!isExistingRecord(value)) {
    throw new TypeError(
      `${build.operation}: ${field} must be ${expected}, but received ${describeValue(value)}.`,
    );
  }
  assertNotMixed(build, field, value, "uri", expected);
  const choice = existing(build, field, value, collections);
  const collection = collections?.find((candidate) => candidate === collectionOf(choice.uri));
  return { collection, field, choice };
}

/**
 * Plans the creation of a new record of `kind` from the caller's data, without sending any
 * request: validates the input, and plans every record that the input's reference fields point at,
 * at any depth, so every problem in the data is found before the first request.
 *
 * Throws TypeError, naming `field`, for any problem in the data.
 */
export function planNew<T extends { createdAt?: string | undefined }>(
  build: BuildContext,
  field: string,
  kind: RecordKind<T>,
  value: unknown,
): NewSlot {
  const input = parseInput(build, field, kind.input, value);
  const targets = planReferences(build, field, kind, input);
  return {
    collection: kind.schema.$type,
    field,
    choice: {
      kind: "new",
      key: recordKeyOf(kind, input),
      references: targets,
      prepare: (refOf) =>
        buildRecord(kind, build, withReferences(input, kind, targets, refOf), field),
    },
  };
}

function planReferences(
  build: BuildContext,
  field: string,
  kind: RecordKind<unknown>,
  input: unknown,
): Record<string, Slot | Slot[]> {
  const targets: Record<string, Slot | Slot[]> = {};
  for (const [name, spec] of Object.entries(kind.references)) {
    const value = (input as Record<string, unknown>)[name];
    if (value === undefined) continue;
    const at = `${field}.${name}`;
    if (spec.many) {
      targets[name] = (value as unknown[]).map((entry, i) =>
        referenceSlot(build, `${at}[${i}]`, entry, spec),
      );
    } else if (spec.when === undefined || spec.when(value)) {
      targets[name] = referenceSlot(build, at, value, spec);
    }
  }
  return targets;
}

function referenceSlot(
  build: BuildContext,
  field: string,
  value: unknown,
  { kind }: ReferenceField,
): Slot {
  return kind === undefined
    ? toExistingSlot(build, field, value)
    : toSlot(build, field, value, kind(), false);
}

// The input with the fields that point at other records replaced by the references they got.
function withReferences<T>(
  input: T,
  kind: RecordKind<T>,
  targets: Readonly<Record<string, Slot | readonly Slot[]>>,
  refOf: ReferenceOf,
): T {
  const stored = Object.entries(targets).map(([name, target]) => {
    const ref = (slot: Slot) =>
      kind.references[name]?.typed ? strongRef.main.build(refOf(slot)) : refOf(slot);
    return [name, isSlotList(target) ? target.map(ref) : ref(target)] as const;
  });
  return { ...input, ...Object.fromEntries(stored) };
}

function slotTag(value: object): "inline" | "uri" | undefined {
  if ("inline" in value) return "inline";
  if ("uri" in value) return "uri";
  return undefined;
}

function assertNotMixed(
  build: BuildContext,
  field: string,
  value: object,
  tag: "inline" | "uri",
  expected: string,
): void {
  if (Object.keys(value).length > 1) {
    throw new TypeError(
      `${build.operation}: ${field} combines \`${tag}\` with other fields. Pass ${expected}, not a mix: \`uri\` reuses an existing record and the record's own fields create a new one.`,
    );
  }
}

const inlineValue = l.object({ inline: l.string() });
const existingRecord = l.object({ uri: l.string({ format: "at-uri" }) });

// The collection part of a record URI, which `at-uri` alone does not require.
const collectionOf = (uri: string): string | undefined => uri.split("/")[3];

function existing(
  build: BuildContext,
  field: string,
  value: object,
  collections: NsidString | readonly NsidString[] | undefined,
): Extract<SlotChoice, { kind: "existing" }> {
  const { uri } = parseInput(build, field, existingRecord, value);
  const allowed: readonly string[] | undefined =
    typeof collections === "string" ? [collections] : collections;
  // `at-uri` alone also accepts other record types, handle authorities and URIs without a key. The
  // authority and type are checked here so a wrong one fails before any request, naming the field;
  // `resolveRecordRef` rejects the rest.
  const authority = uri.split("/")[2];
  if (authority === undefined || !isDidString(authority)) {
    throw new TypeError(
      `${build.operation}: ${field} must use a DID as the authority, not a handle: ${uri}. Expected at://<did>/<collection>/<rkey>.`,
    );
  }
  const actual = collectionOf(uri);
  if (actual === undefined || (allowed !== undefined && !allowed.includes(actual))) {
    const target =
      actual === undefined ? "something that is not a record" : `a record of type ${actual}`;
    throw new TypeError(
      `${build.operation}: ${field} points at ${target}, but this field holds ${allowed?.join(", ") ?? "a record"}: ${uri}. Expected at://<did>/${allowed?.join("|") ?? "<collection>"}/<rkey>.`,
    );
  }
  return { kind: "existing", uri };
}

/**
 * Every slot in `slots`, and every slot they point at, at any depth. A record comes after the
 * records it points at, so the order is also the order the records are written in.
 */
export function flattenSlots(slots: readonly Slot[]): Slot[] {
  return slots.flatMap((slot) => [
    ...(slot.choice.kind === "new" ? flattenSlots(referencedSlots(slot.choice)) : []),
    slot,
  ]);
}

const referencedSlots = ({ references }: NewChoice): Slot[] =>
  Object.values(references).flatMap((target) => (isSlotList(target) ? [...target] : [target]));

/** The slots of `slots` whose record this call creates. */
export const newSlots = (slots: readonly Slot[]): NewSlot[] => slots.filter(isNew);

/**
 * Fails when two records the call creates would have the same URI, because they chose the same
 * record key: the second could not be created, and the call could not say which was meant.
 *
 * Throws TypeError, naming both fields.
 */
export function assertDistinctKeys(build: BuildContext, slots: readonly NewSlot[]): void {
  const seen = new Map<string, NewSlot>();
  for (const slot of slots) {
    if (slot.choice.key === undefined) continue;
    const uri = `at://${build.did}/${slot.collection}/${slot.choice.key}`;
    const first = seen.get(uri);
    if (first !== undefined) {
      throw new TypeError(
        `${build.operation}: ${first.field} and ${slot.field} are both new ${slot.collection} records with the key ${slot.choice.key}, so they would be the same record (${uri}). A call can create a key once. To use one record in several places, create it separately first and pass { uri } in the other places.`,
      );
    }
    seen.set(uri, slot);
  }
}

/**
 * Reads, before anything is uploaded or written, what the call depends on: every `existing` slot
 * from the PDS that hosts it, in parallel, and (with `checkKeys`) that no record exists yet at the
 * key a new record chose. A failure here has no side effects.
 *
 * Throws what `resolveRecordRef` throws, and RecordAlreadyExistsError when a chosen key is taken.
 */
export async function readBeforeWriting(
  build: BuildContext,
  slots: readonly Slot[],
  { checkKeys }: { checkKeys: boolean },
): Promise<Map<Slot, StrongRef>> {
  const [resolved] = await Promise.all([
    settle(slots, ({ choice }) =>
      choice.kind === "existing" ? resolveRecordRef(build.context, choice.uri) : undefined,
    ),
    checkKeys ? assertKeysFree(build, newSlots(slots)) : undefined,
  ]);
  return resolved;
}

async function assertKeysFree(build: BuildContext, slots: readonly NewSlot[]): Promise<void> {
  await Promise.all(
    slots.map(async ({ collection, field, choice: { key } }) => {
      if (key === undefined) return;
      const uri = `at://${build.did}/${collection}/${key}`;
      let taken: boolean;
      try {
        taken = await recordExists(build.context, build.did, collection, key);
      } catch (error) {
        throw new Error(
          `${build.operation}: cannot check whether ${uri} already exists (${describeError(error)}), so nothing was written.`,
          { cause: error },
        );
      }
      if (taken) {
        throw new RecordAlreadyExistsError(
          `${build.operation}: ${field} is a new ${collection} record with the key ${key}, but ${uri} already exists, so nothing was written and the existing record is unchanged. Pass { uri: "${uri}" } where the input accepts an existing record, or choose another key.`,
          uri,
          [],
          { status: 400, code: "InvalidSwap" },
        );
      }
    }),
  );
}

/**
 * Builds every `new` slot's record (uploads included) in parallel, each after the records it
 * points at, whose CIDs are part of its own. `slots` must hold every slot a record points at.
 */
export async function prepareNew(
  slots: readonly Slot[],
  existingRefs: ReadonlyMap<Slot, StrongRef>,
): Promise<Map<Slot, PreparedRecord>> {
  const started = new Map<NewSlot, Promise<PreparedRecord>>();

  // Each record is prepared once, however many records point at it.
  const prepare = (slot: NewSlot): Promise<PreparedRecord> => {
    let pending = started.get(slot);
    if (pending === undefined) {
      pending = prepareAfterReferences(slot.choice);
      started.set(slot, pending);
    }
    return pending;
  };

  async function referenceOfTarget(target: Slot): Promise<StrongRef> {
    const known = existingRefs.get(target);
    if (known !== undefined) return known;
    if (!isNew(target)) throw new Error(`no reference was prepared for ${target.field}.`);
    return (await prepare(target)).ref;
  }

  async function prepareAfterReferences(choice: NewChoice): Promise<PreparedRecord> {
    const refs = new Map(
      await Promise.all(
        referencedSlots(choice).map(
          async (target) => [target, await referenceOfTarget(target)] as const,
        ),
      ),
    );
    return choice.prepare((target) => {
      const ref = refs.get(target);
      if (ref === undefined) throw new Error(`no reference was prepared for ${target.field}.`);
      return ref;
    });
  }

  const prepared = await Promise.all(
    newSlots(slots).map(async (slot) => [slot, await prepare(slot)] as const),
  );
  return new Map(prepared);
}

/**
 * The reference every slot has once the reads and the builds are done: the resolved CID of an
 * existing record, or the CID computed for a new one.
 */
export function referenceLookup(
  existingRefs: ReadonlyMap<Slot, StrongRef>,
  created: ReadonlyMap<Slot, PreparedRecord>,
): ReferenceOf {
  return (slot) => {
    const ref = existingRefs.get(slot) ?? created.get(slot)?.ref;
    if (ref === undefined) throw new Error(`no reference was prepared for ${slot.field}.`);
    return ref;
  };
}

/** The reference of the record in `slot`, with whether this call created it. */
export function recordRef(
  slot: Slot,
  created: ReadonlyMap<Slot, PreparedRecord>,
  refOf: ReferenceOf,
): SupportingRecordRef {
  return { ...refOf(slot), created: created.has(slot) };
}

/**
 * What the call did for the record in `slot`: its reference with whether this call created it, and
 * the results for the records it points at (see `referencedResults`). `TResult` is the public
 * result type of the caller, which declares the same shape.
 */
export function resultOf<TResult>(
  slot: Slot,
  created: ReadonlyMap<Slot, PreparedRecord>,
  refOf: ReferenceOf,
): TResult {
  return {
    ...recordRef(slot, created, refOf),
    ...referencedResults(slot, created, refOf),
  } as TResult;
}

/**
 * What the call did for the records `slot` points at, under the field names of the input and nested
 * like it, to any depth: one result for a field with one entry, a list for a field with many.
 */
export function referencedResults(
  slot: Slot,
  created: ReadonlyMap<Slot, PreparedRecord>,
  refOf: ReferenceOf,
): Record<string, unknown> {
  if (slot.choice.kind !== "new") return {};
  const result = (target: Slot) => resultOf(target, created, refOf);
  return Object.fromEntries(
    Object.entries(slot.choice.references).map(([name, target]) => [
      name,
      isSlotList(target) ? target.map(result) : result(target),
    ]),
  );
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
