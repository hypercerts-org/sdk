import { creatorOf, type StandaloneCreator } from "../internal/create-record.js";
import {
  type CreateVocabularyTagResult,
  type VocabularyTagInput,
  vocabularyTagKind,
} from "./build-tag.js";

/**
 * Creates a vocabulary tag (`org.hypercerts.vocab.tag`), a reusable term for classifying Hypercerts
 * records, in the authenticated account's repo, if it does not exist yet.
 *
 * @remarks
 * The record key is `<category>.<key>`, for example `zone-role.site`, used exactly as given. So an
 * account has one tag per category and key. This function only creates; if the key is taken it
 * throws {@link RecordAlreadyExistsError} with the existing tag's URI, which you can pass as
 * `{ uri }` instead.
 *
 * `broader` and `supersededBy` take a new vocabulary tag's fields or `{ uri }` of an existing one,
 * nested to any depth. Two new tags in one call cannot have the same key.
 *
 * OAuth permissions: creating only this tag needs both `create` and `update` on
 * `org.hypercerts.vocab.tag` (the SDK uses `putRecord` so two calls can't overwrite each other);
 * with only `create` it throws {@link WriteRejectedError}. Creating nested tags too needs only
 * `create`, and everything is created in one write of at most 200 records.
 *
 * `createdAt` defaults to the time of the call. A `Blob` in `referenceDocument` is uploaded. Blobs
 * are uploaded before the write and are not rolled back if it fails; see {@link uploadBlob}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The tag's data. See {@link VocabularyTagInput}.
 * @param options - Optional. `{ repo }`: the DID of an organization to write to through the Certified Group Service instead of the account's own repository; see {@link WriteOptions}. Needs `cgs` on the context.
 * @returns The new tag's URI and CID with `created: true`, and the results for the tags it points
 * at. See {@link CreateVocabularyTagResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a `category` or `key` that is not a
 * valid record key or contains a dot, a `broader` or `supersededBy` entry that is not a tag's data
 * or `{ uri }` (or combines `uri` with other fields, or points at another type of record), two new
 * tags with the same key, more new records than one write holds, or a value the lexicon does not
 * allow. Nothing was written. Blobs may already have been uploaded when a lexicon rule rejects a
 * record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, the
 * key of a new nested tag cannot be checked ("cannot check whether … already exists", nothing was
 * written), or an upload fails.
 * @throws {@link RecordAlreadyExistsError} If a new tag's key is taken. Nothing was written and the
 * existing tag is unchanged.
 * @throws {@link WriteRejectedError} If the PDS rejected the write for another reason (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If there was no usable answer from the PDS. Calling
 * again cannot create duplicates, because every tag it creates has a fixed key, but a
 * {@link RecordAlreadyExistsError} from the retry only means one key is taken, and a retry that
 * races the first write can throw {@link WriteOutcomeUnknownError} again. Check each attempted URI
 * before treating the tags as created.
 * @throws {@link PartialWriteError} For organization writes through CGS, if a write fails after at least one record of the call was written. Nothing is rolled back.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createVocabularyTag } from "@hypercerts-org/sdk/tag";
 *
 * // `context` comes from createSDKContext.
 * const tag = await createVocabularyTag(context, {
 *   category: "land-cover",
 *   key: "mangrove",
 *   name: "Mangrove",
 *   status: "accepted",
 *   broader: [{ category: "land-cover", key: "forest", name: "Forest", status: "accepted" }], // created too
 * });
 * console.log(tag.uri); // at://<did>/org.hypercerts.vocab.tag/land-cover.mangrove
 * ```
 *
 * @example A dot in the category or key is rejected
 * ```ts
 * import { createVocabularyTag } from "@hypercerts-org/sdk/tag";
 *
 * await createVocabularyTag(context, {
 *   category: "land-cover",
 *   key: "mangrove.red", // TypeError: must not contain dots
 *   name: "Red mangrove",
 *   status: "proposed",
 * });
 * ```
 *
 * @example Reuse a tag that already exists
 * ```ts
 * import { createVocabularyTag, RecordAlreadyExistsError } from "@hypercerts-org/sdk/tag";
 *
 * try {
 *   await createVocabularyTag(context, { category: "land-cover", key: "mangrove", name: "Mangrove", status: "accepted" });
 * } catch (error) {
 *   if (!(error instanceof RecordAlreadyExistsError)) throw error;
 *   // `error.uri` is the tag that is already there; pass it as `{ uri }` where a tag is accepted.
 * }
 * ```
 */
export const createVocabularyTag: StandaloneCreator<VocabularyTagInput, CreateVocabularyTagResult> =
  creatorOf("createVocabularyTag", vocabularyTagKind);
