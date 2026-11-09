import type { AtUriString, DidString, LexMap, l, NsidString, RecordKeyString } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import type { StrongRef } from "./resolve-record-ref.js";
import { nextTid } from "./tid.js";

/**
 * A record that is ready to be written: validated, with the record key chosen and its CID
 * computed, so other records can reference it before anything is submitted.
 */
export interface PreparedRecord {
  readonly collection: NsidString;
  readonly rkey: RecordKeyString;
  /** The record exactly as it will be submitted. The CID is computed over this value. */
  readonly value: LexMap;
  /** The URI and CID the record will have once the PDS commits it. */
  readonly ref: StrongRef;
}

/**
 * The record key a lexicon fixes for its records (`literal:self` gives `self`), or `undefined` when
 * the key is chosen by the writer. Such a record exists at most once per repo.
 */
export function fixedRecordKey(schema: l.RecordSchema): RecordKeyString | undefined {
  return schema.key.startsWith("literal:")
    ? (schema.key.slice("literal:".length) as RecordKeyString)
    : undefined;
}

/**
 * Validates a record and computes the URI and CID it will have in `did`'s repo, without writing it.
 *
 * Internal. Boundaries:
 * - Uses `chosenKey` when the input decides the key (a vocabulary tag's `<category>.<key>`), after
 *   checking it against the lexicon's key rule; otherwise the key the lexicon fixes (see
 *   `fixedRecordKey`); otherwise allocates a fresh TID (see `nextTid`). Builds the URI from `did`.
 * - Validates against the lexicon's `RecordSchema`; the lexicon decides what is valid, not the SDK.
 * - The CID is that of the DAG-CBOR encoding of the validated value, the same function the
 *   reference PDS applies to the record it receives, so the PDS arrives at the same CID as long as
 *   it stores the record unchanged. `submitWrites` checks this against the PDS's response.
 *
 * Throws LexValidationError when the record or `chosenKey` does not satisfy the schema, and Error
 * when the value cannot be encoded (for example a non-integer number).
 */
export async function prepareRecord<S extends l.RecordSchema>(
  did: DidString,
  schema: S,
  input: Omit<l.InferInput<S>, "$type">,
  chosenKey?: RecordKeyString,
): Promise<PreparedRecord> {
  const result = schema.safeValidate(schema.build(input));
  if (!result.success) throw result.reason;
  const value: LexMap = result.value;
  if (chosenKey !== undefined) {
    const key = schema.keySchema.safeValidate(chosenKey);
    if (!key.success) throw key.reason;
  }
  const rkey = chosenKey ?? fixedRecordKey(schema) ?? nextTid();
  const uri: AtUriString = `at://${did}/${schema.$type}/${rkey}`;
  const cid = (await cidForLex(value)).toString();
  return { collection: schema.$type, rkey, value, ref: { uri, cid } };
}
