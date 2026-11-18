import type { ActivityEntry, ActivityEntryResult } from "../activity/activity-entry.js";
import type { SDKContext } from "../context.js";
import type { StrongRef } from "../internal/resolve-record-ref.js";
import { addActivity } from "./add-activity.js";

const OPERATION = "addActivityToCollection";

/** The input of {@link addActivityToCollection}. */
export interface AddActivityToCollectionInput {
  /**
   * The Collection to add to, as `at://<did>/org.hypercerts.collection/<rkey>`. It must belong to
   * the account the client is signed in as, and be identified by a DID, not a handle.
   */
  collectionUri: string;
  /** The Activity to add: `{ activity }` (new) or `{ uri }` (existing). See {@link ActivityEntry}. */
  activity: ActivityEntry;
  /** A positive decimal as a string, such as `"2"` or `"0.5"`, kept as written. Up to 100 chars. */
  weight?: string | undefined;
}

/** The result of {@link addActivityToCollection}. */
export interface AddActivityToCollectionResult {
  /** The Activity, created or reused. See {@link ActivityEntryResult}. */
  activity: ActivityEntryResult;
  /** The Collection after the update: its unchanged URI and the CID of its new version. */
  collection: StrongRef;
}

/**
 * Adds an Activity to an existing Collection (`org.hypercerts.collection`) in one atomic write.
 *
 * @remarks
 * `activity` is `{ activity }` (a new Activity, created as {@link createActivity} does) or
 * `{ uri }` (an existing one, read once for its CID and never changed). It is appended as the
 * last item, with `weight`, and the rest of the Collection is kept. Nothing is deduplicated. If the
 * account was written to after the Collection was read, the write fails with
 * {@link WriteRejectedError} (`code` `"InvalidSwap"`) and nothing is written: call again. Only your
 * own Collections; `signatures` are neither checked nor re-signed. See the SDK skill reference.
 *
 * @param context - The shared context from {@link createSDKContext}, with an authenticated client.
 * @param input - The Collection, the Activity and an optional weight.
 * @returns The Activity (`created` is `false` for `{ uri }`) and the Collection's new version.
 * @throws {@link TypeError} If the input is invalid or the Collection is not your own. Nothing
 * was written.
 * @throws {@link Error} If a read or upload fails, or the Collection is invalid or full (1000
 * items). Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write. Nothing was changed.
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to retry.
 *
 * @example
 * ```ts
 * import { addActivityToCollection } from "@hypercerts-org/sdk/collection";
 *
 * // `context` comes from createSDKContext. `activity` is { activity } or { uri }, never bare data.
 * const { activity, collection } = await addActivityToCollection(context, {
 *   collectionUri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8",
 *   activity: { activity: { title: "Reforestation", shortDescription: "Planting trees." } },
 *   weight: "2",
 * });
 * ```
 */
export async function addActivityToCollection(
  context: SDKContext,
  input: AddActivityToCollectionInput,
): Promise<AddActivityToCollectionResult> {
  return addActivity(context, OPERATION, { uriField: "collectionUri", noun: "Collection" }, input);
}
