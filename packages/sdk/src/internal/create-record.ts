import type { SDKContext } from "../context.js";
import { createBuildContext } from "./build-context.js";
import type { RecordKind } from "./record-kind.js";
import type { StrongRef } from "./resolve-record-ref.js";
import {
  assertDistinctKeys,
  flattenSlots,
  newSlots,
  planNew,
  prepareNew,
  readBeforeWriting,
  referenceLookup,
  resultOf,
} from "./slots.js";
import { assertWithinWriteLimit, submitCreateOnly, submitWrites } from "./submit-writes.js";

/**
 * Creates one record and every new record it points at: validates `input`, reads what the call
 * depends on, builds the records and writes them. Nothing is written unless the whole input is
 * valid, and nothing is uploaded when an existing record cannot be read or a chosen record key is
 * taken.
 *
 * Internal. Backs the standalone creators, which therefore share their builders with
 * `createActivity`. Returns the new record's reference with `created: true`, and the result of
 * every record its reference fields point at under the same field names (see `referencedResults`).
 * `TResult` is the public result type of the caller, which declares the same shape.
 *
 * A record that is the only one the call creates and has a key the input decided (a profile's
 * `self`, a vocabulary tag's `<category>.<key>`) is written with `submitCreateOnly`, so an existing
 * record is reported instead of overwritten, even when two calls race. Everything else is written
 * with `submitWrites` in one request, after checking that no new record's chosen key is taken.
 *
 * Throws TypeError for invalid input or more records than one write holds, and what the reads and
 * the writes throw.
 */
export async function createRecordTree<T extends { createdAt?: string | undefined }, TResult>(
  context: SDKContext,
  operation: string,
  kind: RecordKind<T>,
  input: unknown,
): Promise<TResult> {
  const build = createBuildContext(context, operation);
  const root = planNew(build, "input", kind, input);
  const slots = flattenSlots([root]);
  const fresh = newSlots(slots);
  assertDistinctKeys(build, fresh);
  assertWithinWriteLimit(operation, fresh.length);

  const createOnly = fresh.length === 1 && root.choice.key !== undefined;
  const existing = await readBeforeWriting(build, slots, { checkKeys: !createOnly });
  const created = await prepareNew(slots, existing);
  const records = [...created.values()];
  const [only] = records;
  if (createOnly && only !== undefined) {
    await submitCreateOnly(context, build.did, only, operation);
  } else {
    // Calling again cannot duplicate records when every one has a key the input decided.
    const retrySafe = fresh.every((slot) => slot.choice.key !== undefined);
    await submitWrites(context, build.did, records, operation, { retrySafe });
  }

  return resultOf(root, created, referenceLookup(existing, created));
}

/**
 * Creates one record on its own: see `createRecordTree`. Returns only its URI and CID.
 *
 * Internal. Used by the standalone creators whose record points at no other record.
 */
export async function createStandalone<T extends { createdAt?: string | undefined }>(
  context: SDKContext,
  operation: string,
  kind: RecordKind<T>,
  input: unknown,
): Promise<StrongRef> {
  const { uri, cid } = await createRecordTree<T, StrongRef>(context, operation, kind, input);
  return { uri, cid };
}

/**
 * A function that creates one record on its own, as the standalone creators are. It returns the
 * new record's URI and CID, or `TResult` for a record that points at other records, which also
 * reports those.
 */
export type StandaloneCreator<T, TResult = StrongRef> = (
  context: SDKContext,
  input: T,
) => Promise<TResult>;
