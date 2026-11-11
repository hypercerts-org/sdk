import { l } from "@atproto/lex";
import { createRecordTree, type StandaloneCreator } from "../internal/create-record.js";
import { blobOrUrl } from "../internal/input.js";
import { mediaValue } from "../internal/media.js";
import {
  type FieldTransform,
  type RecordKind,
  type ReferenceField,
  references,
} from "../internal/record-kind.js";
import { type ExistingRecord, isExistingRecord } from "../internal/slots.js";
import { locationKind } from "../location/build-location.js";

// What more than one of the context records have in common: `content`, DID lists, decimal strings,
// links to other records, and the way a creator is bound to its kind.

/** Input schema of an optional `content` array: files to upload and URLs to keep. */
export const contentInput = l.optional(l.array(blobOrUrl));

/**
 * The `recordKind` transform of a `content` array: each `Blob` is uploaded as `smallBlob` and each
 * string kept as `org.hypercerts.defs#uri`, in the order given.
 */
export const contentTransform: FieldTransform = (build, field, value: readonly (Blob | string)[]) =>
  Promise.all(value.map((item, i) => mediaValue(build, `${field}[${i}]`, item, "blob")));

/** A list of DIDs, for example `["did:plc:abc123"]`. */
export const didListInput = l.array(l.string({ format: "did" }));

/**
 * The `recordKind` transform of a DID list: the lexicon stores each DID as an
 * `app.certified.defs#did` object.
 */
export const didListTransform: FieldTransform = (_build, _field, dids: readonly string[]) =>
  Promise.resolve(dids.map((did) => ({ did })));

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * A decimal number written as a string, for example `"1234.56"` or `"-3"`. The lexicons store
 * measured values and scores as numeric strings so that no precision is lost; this rejects a
 * JavaScript number (which would be converted silently) and text such as `"1,234"` or `"1e3"`.
 * The string is kept as written. Its length is left to the lexicon.
 */
export const decimalString = l.custom<string>(
  (value): value is string => typeof value === "string" && DECIMAL.test(value),
  'must be a decimal number written as a string, such as "1234.56" or "-3", not a JavaScript number',
);

/**
 * Input schema of a field that is `{ uri }` of an existing record, of any type. For a required
 * link: an optional one is declared by its `ReferenceField` alone.
 */
export const existingRecordInput = l.custom<ExistingRecord>(
  isExistingRecord,
  'must be { uri } of an existing record, for example { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8" }',
);

/** A field that holds one existing record of any type: `{ uri }`, stored as a strong reference. */
export const existingRecordReference: ReferenceField = { kind: undefined, many: false };

/** A field that holds an array of existing records of any type: `{ uri }` entries. */
export const existingRecordsReference: ReferenceField = { kind: undefined, many: true };

/** A field that holds one location: the data of a new one or `{ uri }` of an existing one. */
export const locationReference: ReferenceField = references.one(() => locationKind);

/** A field that holds an array of locations: each the data of a new one or `{ uri }` of an existing one. */
export const locationsReference: ReferenceField = references.many(() => locationKind);

/**
 * The public creator of a record kind: creates the record and every new record it points at in one
 * write (see `createRecordTree`) and returns the record's reference with the results for the
 * records it points at. `TResult` is the creator's public result type, which declares that shape.
 * `operation` is the public function's name, used in error messages.
 */
export const creatorOf =
  <TInput extends { createdAt?: string | undefined }, TResult>(
    operation: string,
    kind: RecordKind<TInput>,
  ): StandaloneCreator<TInput, TResult> =>
  (context, input) =>
    createRecordTree(context, operation, kind, input);
