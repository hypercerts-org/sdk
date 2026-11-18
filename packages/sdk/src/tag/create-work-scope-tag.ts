import { creatorOf, type StandaloneCreator } from "../internal/create-record.js";
import {
  type CreateWorkScopeTagResult,
  type WorkScopeTagInput,
  workScopeTagKind,
} from "./build-tag.js";

/**
 * Creates a work-scope tag (`org.hypercerts.workscope.tag`), a reusable scope atom that CEL work
 * scope expressions are built from, in the authenticated account's repo.
 *
 * @remarks
 * Nothing is deduplicated: calling this twice creates two tags, even with the same `key`. To reuse
 * a tag, pass its URI in `usedTags` of {@link createActivity}.
 *
 * `parent` and `supersededBy` take a new work-scope tag's fields or `{ uri }` of an existing one,
 * nested to any depth. Everything is created in one write of at most 200 records: all of it exists
 * afterwards, or none does. `createdAt` defaults to the time of the call.
 *
 * A `Blob` in `referenceDocument` is uploaded. Blobs are uploaded before the write and are not
 * rolled back if it fails; see {@link uploadBlob}.
 *
 * @param context - The shared context from {@link createSDKContext}. Its client must be
 * authenticated.
 * @param input - The tag's data. See {@link WorkScopeTagInput}.
 * @param options - Optional. `{ repo }`: the DID of an organization to write to through the Certified Group Service instead of the account's own repository; see {@link WriteOptions}. Needs `cgs` on the context.
 * @returns The new tag's URI and CID with `created: true`, and the results for the tags it points
 * at. See {@link CreateWorkScopeTagResult}.
 * @throws {@link TypeError} If `input` has an unknown field, a `parent` or `supersededBy` that is
 * not a tag's data or `{ uri }` (or combines `uri` with other fields, or points at another type of
 * record), more new records than one write holds, or a value the lexicon does not allow. Nothing
 * was written. Blobs may already have been uploaded when a lexicon rule rejects a record.
 * @throws {@link Error} If the client is not authenticated, an existing record cannot be read, or
 * an upload fails.
 * @throws {@link WriteRejectedError} If the PDS rejected the write (HTTP 4xx).
 * @throws {@link WriteOutcomeUnknownError} If the PDS gave no usable answer. Not safe to call again:
 * a retry can duplicate records under new keys.
 * @throws {@link PartialWriteError} With `{ repo }` of an organization, if a write fails after at least one record of the call was written. Nothing is rolled back.
 * @throws {@link WriteResultMismatchError} If the PDS reported different URIs or CIDs than the SDK
 * computed.
 *
 * @example
 * ```ts
 * import { createWorkScopeTag } from "@hypercerts-org/sdk/tag";
 *
 * // `context` comes from createSDKContext.
 * const tag = await createWorkScopeTag(context, {
 *   key: "mangrove_restoration",
 *   name: "Mangrove restoration",
 *   category: "topic",
 *   parent: { key: "ecosystem_restoration", name: "Ecosystem restoration" }, // created too
 * });
 * console.log(tag.uri, tag.parent?.uri);
 * ```
 *
 * @example A vocabulary tag is not a work-scope tag
 * ```ts
 * import { createWorkScopeTag } from "@hypercerts-org/sdk/tag";
 *
 * await createWorkScopeTag(context, {
 *   key: "site",
 *   name: "Site",
 *   // TypeError: this field holds org.hypercerts.workscope.tag
 *   parent: { uri: "at://did:plc:abc123/org.hypercerts.vocab.tag/zone-role.site" },
 * });
 * ```
 */
export const createWorkScopeTag: StandaloneCreator<WorkScopeTagInput, CreateWorkScopeTagResult> =
  creatorOf("createWorkScopeTag", workScopeTagKind);
