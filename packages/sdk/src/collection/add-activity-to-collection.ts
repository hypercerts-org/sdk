import type { ActivityEntryResult } from "../activity/activity-entry.js";
import type { ActivityInput } from "../activity/create-activity.js";
import type { SDKContext } from "../context.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import type { ExistingRecord } from "../internal/slots.js";
import type { WriteOptions } from "../write-options.js";
import { addActivity } from "./add-activity.js";

const OPERATION = "addActivityToCollection";

/** The input of {@link addActivityToCollection}. */
export interface AddActivityToCollectionInput {
  /**
   * The Collection to add to: `{ uri }` as `at://<did>/org.hypercerts.collection/<rkey>`. It must
   * belong to the account the client is signed in as, and be identified by a DID, not a handle. The
   * SDK reads it and writes the new version.
   */
  collection: ExistingRecord;
  /**
   * The Activity to add: the data of a new Activity (see {@link ActivityInput}), or `{ uri }` of an
   * existing one, which is read once for its CID and never changed.
   */
  activity: ActivityInput | ExistingRecord;
  /** A positive decimal as a string, such as `"2"` or `"0.5"`, kept as written. Up to 100 chars. */
  weight?: string | undefined;
}

/**
 * The result of {@link addActivityToCollection}.
 *
 * @remarks
 * `uri` and `cid` are the Collection that was updated: its unchanged URI and the CID of its new
 * version. The Collection is the main record because the call changes it; the Activity may only be
 * reused, and sits beside it as `activity`.
 */
export interface AddActivityToCollectionResult extends StrongRef {
  /** The Activity, created or reused. See {@link ActivityEntryResult}. */
  activity: ActivityEntryResult;
}

/**
 * Adds an Activity to an existing Collection (`org.hypercerts.collection`) in one atomic write.
 *
 * @remarks
 * `collection` is `{ uri }`: a record that is read, and written again with the Activity added.
 * `activity` is the data of a new Activity (created as {@link createActivity} does) or `{ uri }` (an
 * existing one, read once for its CID and never changed). It is appended as the
 * last item, with `weight`, and the rest of the Collection is kept. Nothing is deduplicated.
 *
 * Concurrent changes: with `activity: { uri }` the Collection alone is replaced (`putRecord` with
 * `swapRecord`, the CID of the version read), so only a change to the Collection itself since it
 * was read fails the write; other writes to the account do not. With a new Activity, its records
 * and the Collection go in one `applyWrites`, which can only be guarded by the repository's head
 * commit (`swapCommit`), so any write to the account since then fails it. Both fail with
 * {@link WriteRejectedError} (`code` `"InvalidSwap"`) and nothing is written: call again. Only your
 * own Collections; `signatures` are neither checked nor re-signed. See the SDK skill reference.
 *
 * With `{ repo: orgDid }` the Collection must be in the organization's repository. A new Activity is
 * created first, then the Collection is replaced with one `putRecord` guarded by the Collection's own
 * version (`swapRecord`), so a concurrent change to it is still refused. The repository-wide
 * `swapCommit` that guards the account's own repository when a new Activity is created is not
 * available through the Certified Group Service and is not sent: another write to the organization
 * that does not touch the Collection is not detected. If the update fails after the Activity was created,
 * {@link PartialWriteError} says so; pass the new Activity as `{ uri }` to try again. Replacing a
 * Collection that another member created needs the admin role.
 *
 * @param context - The shared context from {@link createSDKContext}, with an authenticated client.
 * @param input - The Collection, the Activity and an optional weight.
 * @param options - Optional. `{ repo }`: the DID of an organization to write to through the Certified Group Service instead of the account's own repository; see {@link WriteOptions}. Needs `cgs` on the context.
 * @returns The Collection's new version as `uri` and `cid`, and the Activity as `activity` (`created`
 * is `false` for `{ uri }`).
 * @throws {@link TypeError} If the input is invalid or the Collection is not your own. Nothing
 * was written.
 * @throws {@link Error} If a read or upload fails, or the Collection is invalid or full (1000
 * items). Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write, including `"InvalidSwap"` (the
 * Collection, or for a new Activity the repository, changed since it was read). Nothing was changed.
 * @throws {@link PartialWriteError} With `{ repo }` of an organization, if a write fails after at least one record of the call was written. Nothing is rolled back.
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to call again:
 * a retry can duplicate new records under new keys. For `activity: { uri }` only the Collection was written
 * (one `putRecord`): its stored CID is no proof either way. Compare it with the Collection entry of `attempted`:
 * a match means the append applied, so do not call again. Any other CID is inconclusive (another writer
 * may have changed the Collection before or after the append), so check `items` by hand and keep the outcome
 * unknown if that cannot settle it; a retry re-reads the Collection and can add the item twice.
 *
 * @example
 * ```ts
 * import { addActivityToCollection } from "@hypercerts-org/sdk/collection";
 *
 * // `context` comes from createSDKContext. `activity` is the data of a new Activity or { uri }.
 * const { uri, cid, activity } = await addActivityToCollection(context, {
 *   collection: { uri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8" },
 *   activity: { title: "Reforestation", shortDescription: "Planting trees." },
 *   weight: "2",
 * });
 * ```
 */
export async function addActivityToCollection(
  context: SDKContext,
  input: AddActivityToCollectionInput,
  options?: WriteOptions,
): Promise<AddActivityToCollectionResult> {
  return addActivity(
    context,
    OPERATION,
    { field: "collection", noun: "Collection" },
    input,
    options,
  );
}
