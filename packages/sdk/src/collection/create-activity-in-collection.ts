import { l, type RecordKeyString } from "@atproto/lex";
import * as collection from "@hypercerts-org/lexicon/org/hypercerts/collection";
import {
  type ActivityInput,
  type CreateActivityResult,
  prepareActivity,
} from "../activity/build-activity.js";
import type { SDKContext } from "../context.js";
import { type BuildContext, createBuildContext, parseInput } from "../internal/build-context.js";
import { describeError } from "../internal/describe.js";
import { compact, strictObject, weightString } from "../internal/input.js";
import { type PreparedRecord, prepareUpdate } from "../internal/prepare-record.js";
import { readRepoHead } from "../internal/read-repo-head.js";
import {
  parseRecordUri,
  readRecord,
  type StoredRecord,
  type StrongRef,
} from "../internal/resolve-record-ref.js";
import { submitWrites } from "../internal/submit-writes.js";

const OPERATION = "createActivityInCollection";

// The `maxLength` of the lexicon's `items`. Only used to explain a full Collection in plain words:
// validating the updated record against the lexicon still decides what is valid.
const MAX_ITEMS = 1000;

/** The input of {@link createActivityInCollection}. */
export interface CreateActivityInCollectionInput {
  /**
   * The Collection to add the new Activity to, as `at://<did>/org.hypercerts.collection/<rkey>`.
   * It must belong to the account the client is signed in as, and be identified by a DID, not a
   * handle.
   */
  collectionUri: string;
  /** The new Activity and its supporting records. See {@link ActivityInput}. */
  activity: ActivityInput;
  /**
   * The weight of the new item in the Collection, a positive decimal number written as a string
   * (for example `"2"` or `"0.5"`). Weights need not add up to anything; consumers normalise them.
   * At most 100 characters. Left out of the item when not set.
   */
  itemWeight?: string | undefined;
}

/** The result of {@link createActivityInCollection}. */
export interface CreateActivityInCollectionResult {
  /** The new Activity and its supporting records, as {@link createActivity} returns them. */
  activity: CreateActivityResult;
  /** The Collection after the update: its unchanged URI and the CID of its new version. */
  collection: StrongRef;
}

const inputSchema = strictObject({
  collectionUri: l.string(),
  activity: l.unknown(),
  itemWeight: l.optional(weightString),
});

/**
 * Creates an Activity (`org.hypercerts.claim.activity`) and adds it to an existing Collection
 * (`org.hypercerts.collection`) in one atomic write.
 *
 * @remarks
 * The Activity and its supporting records are created exactly as {@link createActivity} creates
 * them, and the Collection's `items` gets one more entry that references the new Activity by URI
 * and CID. All of it goes into a single `com.atproto.repo.applyWrites` request, which the PDS
 * commits as a whole: the Activity, its new supporting records and the new version of the
 * Collection all exist afterwards, or none of it does.
 *
 * Everything else in the Collection is kept as it is, including fields this SDK does not know,
 * `createdAt` and the existing items with their order, weights and references. The existing items
 * are not read again or checked. The new item is appended at the end.
 *
 * Concurrent changes: `applyWrites` cannot say "only if this record is unchanged", so the SDK
 * reads the latest commit of the repository, then the Collection, and asks the PDS to apply the
 * write only if the repository is still at that commit (`swapCommit`). If anything else wrote to
 * the account in between, the PDS rejects the whole request, nothing is written, and this throws
 * {@link WriteRejectedError} with `code` `"InvalidSwap"`. That guards against a lost update, but it
 * is coarse: it also fires for an unrelated write to the same account (a post, a like, another
 * call of this function), so an account that writes often will see it now and then. The window is
 * short, because the uploads happen before the repository is read. The SDK does not retry or
 * merge; call again and it reads the Collection afresh.
 *
 * Signatures: the Collection's `signatures` field is neither checked nor changed. Appending an
 * item changes the record's content, so any signature that was made over the previous content no
 * longer matches it.
 *
 * The session must be allowed to update `org.hypercerts.collection` records as well as to create the
 * Activity's records; a session that may only create records is refused (HTTP 4xx, see
 * {@link WriteRejectedError}).
 *
 * Not checked: whether the Collection is the one the caller meant, whether it already lists an
 * Activity with the same content (nothing is deduplicated), and anything about the existing items.
 * Adding to another account's Collection is not supported.
 *
 * Blobs (`Blob` or `File` values) are uploaded before the write, as in {@link createActivity},
 * and the uploads are outside the atomic write. The order is: validate the input and the
 * Collection's URI, read and check the Collection, read the existing supporting records, upload
 * blobs, read the repository's latest commit, read the Collection again, validate the updated
 * Collection, write. A bad URI, a Collection of another account or one that is missing, full or
 * invalid, an input error or an unreadable supporting record stops before any upload. The
 * Collection is read twice because only the second read, after the latest commit, is guarded by
 * `swapCommit`. If the PDS rejects the write, the uploaded blobs stay unreferenced.
 * A PDS usually deletes unreferenced blobs after a while, but this is not guaranteed, and a blob
 * with the same content that another record already uses stays. After
 * {@link WriteOutcomeUnknownError} or {@link WriteResultMismatchError} the records may exist, so the
 * blobs may be referenced and publicly readable.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the Activity is created in that account's repo, and the Collection must be in it.
 * @param input - The Collection, the Activity and an optional weight. See
 * {@link CreateActivityInCollectionInput}.
 * @returns The new Activity (see {@link CreateActivityResult}) and the Collection's URI with the CID
 * of its new version.
 * @throws {@link TypeError} If `collectionUri` is not `at://<did>/org.hypercerts.collection/<rkey>`,
 * points at another account's repository, or if `activity` or `itemWeight` is invalid. The message
 * names the field. Nothing was written. A weight over 100 characters, or any other rule of the
 * Collection's lexicon, is only found after the blobs are uploaded.
 * @throws {@link Error} If the client is not authenticated, an existing supporting record, the
 * latest commit or the Collection cannot be read, an upload fails, the Collection is not a valid
 * `org.hypercerts.collection` record, or it already holds the 1000 items a Collection can have.
 * Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx). Nothing was created or
 * changed. With `code` `"InvalidSwap"` the repository changed after it was read; call again.
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS (network
 * failure, timeout, a server error), so the records may or may not exist and the Collection may or
 * may not have changed. It lists the URI of the Collection and of every new record. The SDK does
 * not retry, because a retry would create a second Activity if the first attempt had succeeded.
 * Check the URIs, then decide.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed, so the references between the records may not match what is stored.
 *
 * @example Adding a new Activity to a Collection
 * ```ts
 * import { createActivityInCollection } from "@hypercerts-org/sdk/collection";
 *
 * // `context` comes from createSDKContext.
 * const { activity, collection } = await createActivityInCollection(context, {
 *   collectionUri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8",
 *   activity: {
 *     title: "Reforestation in the Phobjikha valley",
 *     shortDescription: "Planting 5,000 native trees.",
 *     locations: [
 *       {
 *         lpVersion: "1.0",
 *         srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
 *         locationType: "coordinate-decimal",
 *         location: { string: "27.47,90.17" },
 *       },
 *     ],
 *   },
 *   itemWeight: "2",
 * });
 * console.log(activity.uri, collection.cid); // the new Activity, and the Collection's new CID
 * ```
 *
 * @example Calling again when the repository changed in between
 * ```ts
 * import { createActivityInCollection, WriteRejectedError } from "@hypercerts-org/sdk/collection";
 *
 * try {
 *   return await createActivityInCollection(context, input);
 * } catch (error) {
 *   if (error instanceof WriteRejectedError && error.code === "InvalidSwap") {
 *     // Another write to the account landed between the read and the write. Nothing was written,
 *     // so it is safe to call again; the Collection is read afresh.
 *     return await createActivityInCollection(context, input);
 *   }
 *   throw error;
 * }
 * ```
 *
 * @example Handling an unknown outcome
 * ```ts
 * import {
 *   createActivityInCollection,
 *   WriteOutcomeUnknownError,
 * } from "@hypercerts-org/sdk/collection";
 *
 * try {
 *   await createActivityInCollection(context, input);
 * } catch (error) {
 *   if (error instanceof WriteOutcomeUnknownError) {
 *     // The Collection is last in `attempted`. Check it and the new Activity with
 *     // com.atproto.repo.getRecord before deciding whether to try again.
 *     console.log(error.attempted.map((ref) => ref.uri));
 *   }
 *   throw error;
 * }
 * ```
 */
export async function createActivityInCollection(
  context: SDKContext,
  input: CreateActivityInCollectionInput,
): Promise<CreateActivityInCollectionResult> {
  const build = createBuildContext(context, OPERATION);
  const { collectionUri, activity, itemWeight } = parseInput(build, "input", inputSchema, input);
  const rkey = parseCollectionUri(build, collectionUri);
  // A first read, so a missing, invalid or full Collection fails before any blob is uploaded. It
  // does not guard the write: the Collection is read again after the head, below.
  checkCollection(await readRecord(context, collectionUri, OPERATION));

  // The records that need the network are read as late as possible, to keep the window in which
  // another write can slip in small. The head comes first: see `readRepoHead`.
  const prepared = await prepareActivity(build, activity, {
    path: "activity",
    // The Collection update goes in the same request.
    otherWrites: 1,
  });
  const head = await readRepoHead(context, build.did, OPERATION);
  const stored = await readRecord(context, collectionUri, OPERATION);
  const item = compact({
    itemIdentifier: { uri: prepared.result.uri, cid: prepared.result.cid },
    itemWeight,
  });
  const updated = await appendItem(build, stored, rkey, item);

  await submitWrites(context, build.did, prepared.writes, OPERATION, {
    updates: [updated],
    swapCommit: head,
  });
  return { activity: prepared.result, collection: updated.ref };
}

// Checked before any request: the URI must name a Collection in the signed-in account's repo.
function parseCollectionUri(build: BuildContext, uri: string): RecordKeyString {
  const { did, collection: type, rkey } = parseRecordUri(uri, OPERATION);
  if (type !== collection.main.$type) {
    throw new TypeError(
      `${OPERATION}: collectionUri points at a record of type ${type}, but it must be of type ${collection.main.$type}: ${uri}. Expected at://<did>/${collection.main.$type}/<rkey>.`,
    );
  }
  if (did !== build.did) {
    throw new TypeError(
      `${OPERATION}: collectionUri is in the repository of ${did}, but the client is signed in as ${build.did} and this operation changes only the signed-in account's own Collections: ${uri}.`,
    );
  }
  return rkey;
}

type Item = NonNullable<collection.Main["items"]>[number];

// The Collection as it will be written: the stored record with `item` added at the end of `items`
// and everything else untouched.
async function appendItem(
  build: BuildContext,
  stored: StoredRecord,
  rkey: RecordKeyString,
  item: Item,
): Promise<PreparedRecord> {
  const current = checkCollection(stored);
  const items = current.items ?? [];
  try {
    // The whole record again, under the key it already has: this prepares an update, not a create.
    return await prepareUpdate(
      build.did,
      collection.main,
      { ...current, items: [...items, item] },
      rkey,
    );
  } catch (error) {
    throw new TypeError(
      `${OPERATION}: the updated Collection is not a valid ${collection.main.$type} record: ${describeError(error)}. No record was written.`,
      { cause: error },
    );
  }
}

// The stored Collection, when it is valid and has room for one more item.
function checkCollection(stored: StoredRecord): collection.Main {
  const { uri } = stored.ref;
  const current = collection.main.safeValidate(stored.value);
  if (!current.success) {
    throw new Error(
      `${OPERATION}: the Collection ${uri} is not a valid ${collection.main.$type} record (${describeError(current.reason)}), so the SDK does not change it. No record was written.`,
      { cause: current.reason },
    );
  }
  const items = current.value.items ?? [];
  if (items.length >= MAX_ITEMS) {
    throw new Error(
      `${OPERATION}: the Collection ${uri} already lists ${items.length} items, the most a Collection can hold (${MAX_ITEMS}). No record was written.`,
    );
  }
  return current.value;
}
