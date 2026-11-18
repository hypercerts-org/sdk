import type { SDKContext } from "../context.js";
import { createBuildContext } from "./build-context.js";
import type { RecordKind } from "./record-kind.js";
import type { StrongRef } from "./resolve-record-ref.js";
import { planNew, prepareSlots, resultOf } from "./slots.js";
import { submitCreateOnly, submitWrites } from "./submit-writes.js";

/**
 * The public creator of a record kind, named `operation` in error messages: creates one record and
 * every new record it points at. Validates `input`, reads what the call depends on, builds the
 * records and writes them. Nothing is written unless the whole input is valid, and nothing is
 * uploaded when an existing record cannot be read or a chosen record key is taken.
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
 * The creator throws TypeError for invalid input or more records than one write holds, and what
 * the reads and the writes throw.
 */
export function creatorOf<T extends { createdAt?: string | undefined }, TResult>(
  operation: string,
  kind: RecordKind<T>,
): StandaloneCreator<T, TResult> {
  return async (context, input) => {
    const build = createBuildContext(context, operation);
    const root = planNew(build, "input", kind, input);
    const { created, refOf, fresh, createOnly } = await prepareSlots(build, [root], {
      createOnly: true,
    });
    const records = [...created.values()];
    const [only] = records;
    if (createOnly && only !== undefined) {
      await submitCreateOnly(build, only);
    } else {
      // Calling again cannot duplicate records when every one has a key the input decided.
      const retrySafe = fresh.every((slot) => slot.choice.key !== undefined);
      await submitWrites(build, records, { retrySafe });
    }

    return resultOf(root, created, refOf);
  };
}

/**
 * Like `creatorOf` for a record that points at no other record: returns only its URI and CID.
 *
 * Internal. Used by the standalone creators.
 */
export function standaloneCreatorOf<T extends { createdAt?: string | undefined }>(
  operation: string,
  kind: RecordKind<T>,
): StandaloneCreator<T> {
  const create = creatorOf<T, StrongRef>(operation, kind);
  return async (context, input) => {
    const { uri, cid } = await create(context, input);
    return { uri, cid };
  };
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
