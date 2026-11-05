import { l } from "@atproto/lex";
import type { SDKContext } from "../context.js";
import {
  type BuildContext,
  createBuildContext,
  parseInput,
  prepareChecked,
} from "./build-context.js";
import { compact, strictObject } from "./input.js";
import type { PreparedRecord } from "./prepare-record.js";
import type { StrongRef } from "./resolve-record-ref.js";
import { submitWrites } from "./submit-writes.js";

/**
 * Turns one input field into the value stored in the record, for example uploading a `Blob` and
 * returning the blob reference. Runs only for fields that are present, and receives a value the
 * input schema has already checked.
 */
export type FieldTransform = (build: BuildContext, field: string, value: never) => Promise<unknown>;

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
}

/**
 * Declares a record kind. `shape` lists the SDK input's fields; `createdAt`, which every record
 * has, is added. Fields named in `transforms` are converted before they are stored, and `refinement`
 * adds a rule that spans fields.
 *
 * The result is typed from `shape`, so assigning it to a `RecordKind` of the public input interface
 * fails to compile when the two drift apart.
 */
export function recordKind<const TShape extends Record<string, l.Validator>>(
  schema: l.RecordSchema,
  shape: TShape,
  transforms: Readonly<Record<string, FieldTransform>> = {},
  refinement?: { check: (input: never) => boolean; message: string },
) {
  const strict = strictObject({ ...shape, createdAt: l.optional(l.string()) });
  const input = refinement ? l.refine(strict, refinement as never) : strict;
  return { schema, input, transforms } satisfies RecordKind<unknown>;
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
  return prepareChecked(build, field, kind.schema, record as never);
}

/**
 * Creates one record on its own: validates `input`, builds the record and writes it. Nothing is
 * written unless the whole input is valid.
 *
 * Internal. Backs the standalone creators, which therefore share their builders with
 * `createActivity`.
 */
export async function createStandalone<T extends { createdAt?: string | undefined }>(
  context: SDKContext,
  operation: string,
  kind: RecordKind<T>,
  input: unknown,
): Promise<StrongRef> {
  const build = createBuildContext(context, operation);
  const record = await buildRecord(
    kind,
    build,
    parseInput(build, "input", kind.input, input),
    "input",
  );
  await submitWrites(context, build.did, [record], operation);
  return record.ref;
}

/** A function that creates one record on its own, as the standalone creators are. */
export type StandaloneCreator<T> = (context: SDKContext, input: T) => Promise<StrongRef>;
