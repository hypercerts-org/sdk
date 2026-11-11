import type { SDKContext } from "../context.js";
import { createBuildContext } from "../internal/build-context.js";
import {
  assertDistinctKeys,
  flattenSlots,
  newSlots,
  prepareNew,
  readBeforeWriting,
  referenceLookup,
} from "../internal/slots.js";
import { assertWithinWriteLimit, submitWrites } from "../internal/submit-writes.js";
import {
  type CollectionInput,
  type CreateCollectionResult,
  planCollection,
} from "./build-collection.js";

const OPERATION = "createCollection";

/**
 * Creates a Collection (`org.hypercerts.collection`) with its items and supporting records, in one
 * atomic write: the Collection, and every new Activity, Feature, child Collection, location and
 * tag in it.
 *
 * @remarks
 * Each item is exactly one of `{ activity }`, `{ feature }` and `{ collection }` (the data of a
 * new record, created with the same rules as {@link createActivity}, {@link createFeature} and
 * this function) or `{ uri }` (an existing Activity, Feature or Collection, reused as it is). The
 * choice is explicit; the SDK never guesses it from the fields. Each item can have a `weight`.
 * The same holds for `location` and `tags`: the data of a new record, or `{ uri }` of an existing
 * one. The SDK builds every strong reference itself, pointing at the exact CID of each new record.
 *
 * Existing records are read once to learn their current CID, never rewritten, and may belong to
 * another account if they are public. Nothing is searched for or deduplicated: the same data twice
 * creates two records, and the same `{ uri }` twice gives two items. Order is kept, and weights are
 * stored as the strings you pass; they are not normalised.
 *
 * `description` is a string or a Leaflet document (with `$type: "pub.leaflet.pages.linearDocument"`),
 * both stored in the Collection, or `{ uri }` of an existing record of any type, stored as a
 * reference. `avatar` and `banner` are a URL string, stored as it is, or an image `Blob` or `File`
 * that the SDK uploads. `createdAt` defaults to the time of the call, for every new record.
 *
 * Everything is created in one `com.atproto.repo.applyWrites` request, which the PDS commits as a
 * whole: all the records exist afterwards, or none do. One write holds at most 200 records, the
 * Collection and every record nested in it included; the SDK never splits a call, so a larger one
 * throws before anything is read or uploaded. Create some records first and pass them as `{ uri }`.
 * The session needs `create` on every collection it writes to.
 *
 * A new tag's record key is `<category>.<key>`, so the SDK checks first that no such tag exists and
 * throws {@link RecordAlreadyExistsError} if one does; use the existing tag's `uri` instead. Two
 * new tags with the same key in one call are a `TypeError`.
 *
 * Order: validate input, count records, read existing records and tag keys, upload blobs, build,
 * write. Input and read errors stop before any upload; a rejected file or lexicon rule is found
 * at build time, after other files may have uploaded. Uploaded blobs are not rolled back; see
 * {@link uploadBlob}.
 *
 * Not supported: the lexicon's `signatures`, a blob that was uploaded already, adding items to a
 * Collection that exists (see {@link createActivityInCollection} for an Activity), and changing
 * an existing record.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated; the records are created in that account's repo.
 * @param input - The Collection, its items and the records it needs. See {@link CollectionInput}.
 * @returns The new Collection's URI and CID, and what was created or reused for its location, tags
 * and items, in input order. See {@link CreateCollectionResult}.
 * @throws {@link TypeError} If `input` has an unknown field, an item that is not exactly one of
 * the four choices, a `{ uri }` that is not an Activity, Feature or Collection (or a location or
 * tag of the wrong type), a `description` that is none of the three forms, an invalid weight, a
 * nested record that is invalid, more new records than one write holds, or any value the lexicons
 * do not allow. The message names the field. Nothing was written.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, the
 * key of a new tag cannot be checked, or an upload fails. Nothing was written.
 * @throws {@link RecordAlreadyExistsError} If a new tag's key is taken. Nothing was written.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to retry:
 * a successful first attempt would be duplicated. `attempted` lists the new records, Collection last.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example A Collection with a new Activity, a new Feature and an existing Activity
 * ```ts
 * import { createCollection } from "@hypercerts-org/sdk/collection";
 *
 * // `context` comes from createSDKContext.
 * const collection = await createCollection(context, {
 *   type: "portfolio",
 *   title: "Phobjikha valley restoration",
 *   description: "Everything we do in the valley.",
 *   avatar: "https://example.org/valley.png", // a URL is stored as it is
 *   items: [
 *     {
 *       activity: {
 *         title: "Reforestation in the Phobjikha valley",
 *         shortDescription: "Planting 5,000 native trees.",
 *       },
 *       weight: "2", // created
 *     },
 *     { feature: { type: "zone", title: "Valley floor zone" } }, // created
 *     { uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2a4b5c6d7e8", weight: "0.5" }, // reused
 *   ],
 * });
 * console.log(collection.uri, collection.items[0]); // { uri, cid, type: "activity", created: true, ... }
 * ```
 *
 * @example A child Collection, a new tag and an existing location
 * ```ts
 * import { createCollection } from "@hypercerts-org/sdk/collection";
 *
 * await createCollection(context, {
 *   title: "Bhutan programmes",
 *   location: { uri: "at://did:plc:abc123/app.certified.location/3k2a4b5c6d7e8" }, // reused
 *   tags: [{ category: "theme", key: "forest", name: "Forest", status: "accepted" }], // created
 *   items: [
 *     {
 *       collection: {
 *         title: "Phobjikha",
 *         items: [{ uri: "at://did:plc:abc123/org.hypercerts.collection/3k2a4b5c6d7e8" }],
 *       },
 *     },
 *   ],
 * });
 * ```
 *
 * @example An item is not a bare Activity
 * ```ts
 * import { createCollection } from "@hypercerts-org/sdk/collection";
 *
 * await createCollection(context, {
 *   title: "Portfolio",
 *   // TypeError: an item is { activity }, { feature }, { collection } or { uri }
 *   items: [{ title: "Reforestation", shortDescription: "Planting trees." } as never],
 * });
 * ```
 *
 * @example Handling an unknown outcome
 * ```ts
 * import { createCollection, WriteOutcomeUnknownError } from "@hypercerts-org/sdk/collection";
 *
 * try {
 *   await createCollection(context, input);
 * } catch (error) {
 *   if (error instanceof WriteOutcomeUnknownError) {
 *     // The Collection is last. Check it with com.atproto.repo.getRecord: the write is
 *     // all-or-nothing, so if it exists, every record in `attempted` does.
 *     console.log(error.attempted.map((ref) => ref.uri));
 *   }
 *   throw error;
 * }
 * ```
 */
export async function createCollection(
  context: SDKContext,
  input: CollectionInput,
): Promise<CreateCollectionResult> {
  const build = createBuildContext(context, OPERATION);
  const planned = planCollection(build, "input", input);
  const slots = flattenSlots([planned.slot]);
  const fresh = newSlots(slots);
  assertDistinctKeys(build, fresh);
  assertWithinWriteLimit(OPERATION, fresh.length);

  // Reads first, then uploads: a URI that cannot be resolved, or a taken tag key, fails before
  // anything is uploaded.
  const existing = await readBeforeWriting(build, slots, { checkKeys: true });
  const created = await prepareNew(slots, existing);
  await submitWrites(context, build.did, [...created.values()], OPERATION);
  return planned.result(created, referenceLookup(existing, created));
}
