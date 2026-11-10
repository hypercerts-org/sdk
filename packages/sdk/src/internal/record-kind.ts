import { l, type RecordKeyString } from "@atproto/lex";
import { type BuildContext, prepareChecked } from "./build-context.js";
import { compact, strictObject } from "./input.js";
import { fixedRecordKey, type PreparedRecord } from "./prepare-record.js";

/**
 * Turns one input field into the value stored in the record, for example uploading a `Blob` and
 * returning the blob reference. Runs only for fields that are present, and receives a value the
 * input schema has already checked.
 */
export type FieldTransform = (build: BuildContext, field: string, value: never) => Promise<unknown>;

/**
 * A field whose value points at other records, which the call creates or reuses: each entry is
 * the data of a new record, or `{ uri }` of an existing one. The record stores strong references.
 */
export interface ReferenceField {
  /**
   * The kind of record an entry creates and an existing record must be, or `undefined` for a field
   * that accepts an existing record of any type. A function, so a kind can point at itself.
   */
  readonly kind: (() => AnyRecordKind) | undefined;
  /** Whether the field holds an array of entries instead of one. */
  readonly many: boolean;
  /**
   * Which values of the field are references. The others are stored through the field's
   * transform. Absent: every value is.
   */
  readonly when?: (value: unknown) => boolean;
  /**
   * Whether the reference is stored with its `$type`, because the lexicon field is a union that
   * has the strong reference as a member. Plain `strongRef` fields and arrays are stored without.
   */
  readonly typed?: boolean;
}

/** A field that holds one entry (`one`) or an array of entries (`many`) that are records of `kind`. */
export const references = {
  one: (kind: () => AnyRecordKind): ReferenceField => ({ kind, many: false }),
  many: (kind: () => AnyRecordKind): ReferenceField => ({ kind, many: true }),
};

/**
 * Everything the SDK needs to know to create one kind of supporting record: the lexicon that
 * validates it, the schema for the SDK's input and the fields that are not stored as given.
 *
 * Internal. Input fields are copied into the record under the same name (the input schema rejects
 * unknown fields, so nothing unintended is copied), which keeps each kind a declaration instead of
 * a hand-written mapping.
 */
export interface RecordKind<T> {
  /** The lexicon's record schema, which decides whether the record is valid. */
  readonly schema: l.RecordSchema;
  /** Validates the input for a new record of this kind. */
  readonly input: l.Schema<T>;
  /** The fields whose stored value differs from the input value, by field name. */
  readonly transforms: Readonly<Record<string, FieldTransform>>;
  /** The fields that point at other records, by field name. */
  readonly references: Readonly<Record<string, ReferenceField>>;
  /**
   * The record key the input decides, for a record whose key is not a TID: it can already be
   * taken. Absent: the lexicon fixes the key or the SDK allocates a TID.
   */
  readonly recordKey: ((input: never) => RecordKeyString) | undefined;
}

/** A kind of any input, for fields that point at another kind. */
export type AnyRecordKind = RecordKind<{ createdAt?: string | undefined }>;

/** What `recordKind` takes besides the schema and the input's fields. */
export interface RecordKindOptions {
  /** Rules that span fields, checked in order. */
  readonly refinements?: readonly Refinement[];
  /** The fields that point at other records; they are added to the input's fields. */
  readonly references?: Readonly<Record<string, ReferenceField>>;
  /** See {@link RecordKind.recordKey}. */
  readonly recordKey?: (input: never) => RecordKeyString;
}

/** A rule that spans fields of an input, with the message shown when it fails. */
export interface Refinement {
  check: (input: never) => boolean;
  message: string;
  path?: string;
}

/**
 * Declares a record kind. `shape` lists the SDK input's fields; `createdAt`, which every record
 * has, is added, and so is each field in `options.references`. Fields named in `transforms` are
 * converted before they are stored, and each of `options.refinements` adds a rule that spans
 * fields, checked in order.
 *
 * The result is typed from `shape`, so assigning it to a `RecordKind` of the public input interface
 * fails to compile when the two drift apart. Reference fields are left out of that type: each
 * entry is read and checked when the call is planned (see `planNew`).
 */
export function recordKind<const TShape extends Record<string, l.Validator>>(
  schema: l.RecordSchema,
  shape: TShape,
  transforms: Readonly<Record<string, FieldTransform>> = {},
  options: RecordKindOptions = {},
) {
  const { refinements = [], references: referenceFields = {}, recordKey } = options;
  // A reference field is only said to be present, and each entry is checked when the call is
  // planned. A field that `shape` declares keeps its own schema, for a field that is only
  // sometimes a reference.
  const fields = {
    ...shape,
    ...Object.fromEntries(
      Object.entries(referenceFields)
        .filter(([name]) => !(name in shape))
        .map(([name, { many }]) => [name, l.optional(many ? l.array(l.unknown()) : l.unknown())]),
    ),
    createdAt: l.optional(l.string()),
  } as TShape & { createdAt: l.Validator<string | undefined> };
  const strict = strictObject(fields);
  const input = refinements.reduce<l.Validator>(
    (schema, refinement) => l.refine(schema, refinement as never),
    strict,
  ) as typeof strict;
  return {
    schema,
    input,
    transforms,
    references: referenceFields,
    recordKey,
  } satisfies RecordKind<unknown>;
}

/** The record key `input` decides, or the one the lexicon fixes, or `undefined` for a new TID. */
export function recordKeyOf<T>(kind: RecordKind<T>, input: T): RecordKeyString | undefined {
  return kind.recordKey?.(input as never) ?? fixedRecordKey(kind.schema);
}

/**
 * Builds and validates a record of `kind` from validated input, without writing it. Transforms
 * (uploads) run in parallel, and `createdAt` defaults to the call's timestamp.
 *
 * Throws TypeError, naming `field`, when the record is not valid for its lexicon, and whatever a
 * transform throws.
 */
export async function buildRecord<T extends { createdAt?: string | undefined }>(
  kind: RecordKind<T>,
  build: BuildContext,
  input: T,
  field: string,
): Promise<PreparedRecord> {
  const fields = await Promise.all(
    Object.entries(input).map(async ([name, value]) => {
      const transform = kind.transforms[name];
      const stored =
        transform === undefined || value === undefined
          ? value
          : await transform(build, `${field}.${name}`, value as never);
      return [name, stored] as const;
    }),
  );
  const record = compact({
    ...Object.fromEntries(fields),
    createdAt: input.createdAt ?? build.createdAt,
  });
  return prepareChecked(build, field, kind.schema, record as never, recordKeyOf(kind, input));
}
